from __future__ import annotations

import asyncio
import logging
import math
import time
from dataclasses import dataclass
from typing import Any, Callable

import httpx

from app.locations.errors import LocationServiceError
from app.locations.models import LocationSuggestion


logger = logging.getLogger(__name__)

AUTH_URL = "https://www.onemap.gov.sg/api/auth/post/getToken"
SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search"
REFRESH_SAFETY_WINDOW = 300.0
AUTH_FAILURE_COOLDOWN = 30.0
TOTAL_REQUEST_DEADLINE = 15.0
HTTP_TIMEOUT = httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0)


@dataclass(frozen=True)
class _Token:
    value: str
    expires_at: float
    generation: int


class _TokenRejected(Exception):
    pass


class OneMapClient:
    """Authenticated OneMap search client with an in-process token cache."""

    def __init__(
        self,
        email: str | None,
        password: str | None,
        *,
        http: httpx.AsyncClient,
        clock: Callable[[], float] = time.time,
    ):
        self.email = (email or "").strip()
        self.password = password or ""
        self.http = http
        self.clock = clock
        self._token: _Token | None = None
        self._generation = 0
        self._refresh_lock = asyncio.Lock()
        self._refresh_task: asyncio.Task[_Token] | None = None
        self._failure_until = 0.0
        self._failure: LocationServiceError | None = None

    async def search(self, query: str) -> list[LocationSuggestion]:
        normalized_query = query.strip()
        if not 2 <= len(normalized_query) <= 100:
            raise LocationServiceError(422, "Search query must be between 2 and 100 characters")

        token = await self._get_token()
        for attempt in range(2):
            try:
                payload = await self._search_with_token(normalized_query, token)
            except _TokenRejected:
                if attempt == 1:
                    self._log_failure("search", "token_rejected_after_retry")
                    raise LocationServiceError(502, "OneMap search unavailable")
                token = await self._get_token(force=True, rejected_generation=token.generation)
                continue
            return self._normalize_results(payload)

        raise LocationServiceError(502, "OneMap search unavailable")

    async def _get_token(
        self,
        *,
        force: bool = False,
        rejected_generation: int | None = None,
    ) -> _Token:
        async with self._refresh_lock:
            current = self._token
            usable = current is not None and current.expires_at - self.clock() > REFRESH_SAFETY_WINDOW

            if not force and usable:
                return current  # type: ignore[return-value]

            if (
                force
                and rejected_generation is not None
                and current is not None
                and current.generation != rejected_generation
                and usable
            ):
                return current

            if self._failure is not None and self.clock() < self._failure_until:
                raise self._failure
            if self._failure is not None:
                self._failure = None
                self._failure_until = 0.0

            if force and current is not None and current.generation == rejected_generation:
                self._token = None

            if self._refresh_task is None or self._refresh_task.done():
                self._refresh_task = asyncio.create_task(self._refresh_token())
            refresh_task = self._refresh_task

        # A cancelled search must not cancel the shared authentication request.
        return await asyncio.shield(refresh_task)

    async def _refresh_token(self) -> _Token:
        if not self.email or not self.password:
            raise LocationServiceError(503, "OneMap is not configured")

        try:
            response = await self._request(
                "POST",
                AUTH_URL,
                json={"email": self.email, "password": self.password},
            )
            payload = self._json_object(response, "authenticate")
            if response.status_code < 200 or response.status_code >= 300:
                raise self._upstream_error("authenticate", "http_status")
            if payload.get("error"):
                raise self._upstream_error("authenticate", "auth_rejected")

            value = payload.get("access_token")
            try:
                expires_at = float(payload.get("expiry_timestamp"))
            except (TypeError, ValueError):
                expires_at = math.nan
            if (
                not isinstance(value, str)
                or not value.strip()
                or not math.isfinite(expires_at)
                or expires_at - self.clock() <= REFRESH_SAFETY_WINDOW
            ):
                raise self._upstream_error("authenticate", "invalid_token_response")

            self._generation += 1
            token = _Token(value.strip(), expires_at, self._generation)
            self._token = token
            self._failure = None
            self._failure_until = 0.0
            return token
        except LocationServiceError as exc:
            if exc.status_code == 502:
                self._record_failure(exc)
            raise
        except (httpx.HTTPError, TimeoutError, asyncio.TimeoutError):
            error = self._upstream_error("authenticate", "request_failed")
            self._record_failure(error)
            raise error

    async def _search_with_token(self, query: str, token: _Token) -> dict[str, Any]:
        try:
            response = await self._request(
                "GET",
                SEARCH_URL,
                params={
                    "searchVal": query,
                    "returnGeom": "Y",
                    "getAddrDetails": "Y",
                    "pageNum": "1",
                },
                headers={"Authorization": token.value},
            )
        except (httpx.HTTPError, TimeoutError, asyncio.TimeoutError) as exc:
            raise self._upstream_error("search", "request_failed") from exc
        if response.status_code == 401:
            raise _TokenRejected()
        payload = self._json_object(response, "search")
        if self._is_token_rejection(response, payload):
            raise _TokenRejected()
        if response.status_code < 200 or response.status_code >= 300:
            raise self._upstream_error("search", "http_status")
        if payload.get("error"):
            raise self._upstream_error("search", "upstream_error")
        if not isinstance(payload.get("results"), list):
            raise self._upstream_error("search", "malformed_results")
        return payload

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        try:
            async with asyncio.timeout(TOTAL_REQUEST_DEADLINE):
                return await self.http.request(method, url, timeout=HTTP_TIMEOUT, **kwargs)
        except (httpx.HTTPError, TimeoutError, asyncio.TimeoutError) as exc:
            raise exc

    @staticmethod
    def _json_object(response: httpx.Response, operation: str) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError as exc:
            logger.warning("source=onemap operation=%s error=invalid_json", operation)
            raise LocationServiceError(502, "OneMap service unavailable") from exc
        if not isinstance(payload, dict):
            logger.warning("source=onemap operation=%s error=invalid_payload", operation)
            raise LocationServiceError(502, "OneMap service unavailable")
        return payload

    @staticmethod
    def _is_token_rejection(response: httpx.Response, payload: dict[str, Any]) -> bool:
        if response.status_code == 401:
            return True
        error = payload.get("error")
        if not isinstance(error, str):
            return False
        message = error.lower()
        return any(marker in message for marker in ("token", "expired", "unauthoriz", "authentication"))

    def _normalize_results(self, payload: dict[str, Any]) -> list[LocationSuggestion]:
        normalized: list[LocationSuggestion] = []
        for raw in payload["results"][:8]:
            if not isinstance(raw, dict):
                raise self._upstream_error("search", "malformed_result")
            label = str(raw.get("SEARCHVAL") or raw.get("ADDRESS") or "").strip()
            try:
                lat = float(raw.get("LATITUDE"))
                lng = float(raw.get("LONGITUDE"))
            except (TypeError, ValueError):
                continue
            if not label or not math.isfinite(lat) or not math.isfinite(lng):
                continue
            if not -90 <= lat <= 90 or not -180 <= lng <= 180:
                continue
            address = str(raw.get("ADDRESS") or "").strip() or None
            postal = str(raw.get("POSTAL") or "").strip() or None
            normalized.append(LocationSuggestion(label=label, address=address, postal=postal, lat=lat, lng=lng))
        return normalized

    @staticmethod
    def _upstream_error(operation: str, category: str) -> LocationServiceError:
        logger.warning("source=onemap operation=%s error=%s", operation, category)
        return LocationServiceError(502, "OneMap service unavailable")

    def _record_failure(self, error: LocationServiceError) -> None:
        self._failure = error
        self._failure_until = self.clock() + AUTH_FAILURE_COOLDOWN
        self._log_failure("authenticate", "cooldown_started")

    @staticmethod
    def _log_failure(operation: str, category: str) -> None:
        logger.warning("source=onemap operation=%s error=%s", operation, category)
