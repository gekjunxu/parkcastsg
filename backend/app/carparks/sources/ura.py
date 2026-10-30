from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime, timedelta, timezone
import logging
from typing import Any

import httpx

from app.carparks.errors import CarparkNotFoundError
from app.carparks.helpers import crowd_level, haversine
from app.carparks.models import CarparkAvailability, LotTypeAvailability


URA_ID_PREFIX = "URA_"
URA_TOKEN_URL = "https://eservice.ura.gov.sg/uraDataService/insertNewToken/v1"
URA_AVAILABILITY_URL = "https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1"
_SINGAPORE_TZ = timezone(timedelta(hours=8))
logger = logging.getLogger(__name__)


class UraSource:
    """URA locations/capacity with optional live car availability."""

    source_name = "ura"
    id_prefix = URA_ID_PREFIX

    def __init__(
        self,
        lookup: Mapping[str, dict],
        api_key: str = "",
        availability_url: str = URA_AVAILABILITY_URL,
        token_url: str = URA_TOKEN_URL,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.lookup = lookup
        self.api_key = api_key
        self.availability_url = availability_url
        self.token_url = token_url
        self.transport = transport
        self._token: str | None = None
        self._token_date: date | None = None

    def _log_warning(self, operation: str, carpark_id: str | None, detail: str) -> None:
        logger.warning(
            "carpark source=%s operation=%s carpark_id=%s detail=%s",
            self.source_name,
            operation,
            carpark_id or "-",
            detail,
        )

    async def _get_token(self, operation: str, carpark_id: str | None) -> str | None:
        if not self.api_key:
            self._log_warning(operation, carpark_id, "URA_API_KEY not configured; using static details")
            return None

        today = datetime.now(_SINGAPORE_TZ).date()
        if self._token and self._token_date == today:
            return self._token

        client_kwargs: dict[str, Any] = {"timeout": 10.0}
        if self.transport is not None:
            client_kwargs["transport"] = self.transport
        try:
            async with httpx.AsyncClient(**client_kwargs) as client:
                response = await client.get(
                    self.token_url,
                    headers={"AccessKey": self.api_key, "accept": "application/json"},
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            self._log_warning(operation, carpark_id, f"token request failed ({exc}); using static details")
            return None

        try:
            payload = response.json()
        except ValueError:
            self._log_warning(operation, carpark_id, "token response was invalid JSON; using static details")
            return None
        token = payload.get("Result") if isinstance(payload, dict) and payload.get("Status") == "Success" else None
        if not isinstance(token, str) or not token.strip():
            self._log_warning(operation, carpark_id, "token response was unsuccessful; using static details")
            return None
        self._token = token.strip()
        self._token_date = today
        return self._token

    async def _fetch_live(
        self, operation: str, carpark_id: str | None
    ) -> tuple[dict[str, int] | None, str | None]:
        token = await self._get_token(operation, carpark_id)
        if token is None:
            return None, None

        client_kwargs: dict[str, Any] = {"timeout": 10.0}
        if self.transport is not None:
            client_kwargs["transport"] = self.transport
        try:
            async with httpx.AsyncClient(**client_kwargs) as client:
                response = await client.get(
                    self.availability_url,
                    params={"service": "Car_Park_Availability"},
                    headers={
                        "AccessKey": self.api_key,
                        "Token": token,
                        "accept": "application/json",
                    },
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            self._log_warning(operation, carpark_id, f"availability request failed ({exc}); using static details")
            return None, None

        try:
            payload = response.json()
        except ValueError:
            self._log_warning(operation, carpark_id, "availability response was invalid JSON; using static details")
            return None, None
        entries = payload.get("Result") if isinstance(payload, dict) and payload.get("Status") == "Success" else None
        if not isinstance(entries, list):
            self._log_warning(operation, carpark_id, "availability response was unsuccessful; using static details")
            return None, None

        availability: dict[str, int] = {}
        for entry in entries:
            if not isinstance(entry, dict) or str(entry.get("lotType", "")).strip().upper() != "C":
                continue
            raw_id = str(entry.get("carparkNo", "")).strip().upper()
            if not raw_id:
                continue
            try:
                available = int(entry.get("lotsAvailable", 0))
            except (TypeError, ValueError):
                self._log_warning(operation, carpark_id, f"invalid availability for {raw_id}")
                continue
            if available < 0:
                self._log_warning(operation, carpark_id, f"invalid availability for {raw_id}")
                continue
            availability[raw_id] = availability.get(raw_id, 0) + available
        return availability, datetime.now(timezone.utc).isoformat()

    def _record(
        self,
        carpark_id: str,
        info: Mapping[str, Any],
        query_lat: float | None,
        query_lng: float | None,
        availability: Mapping[str, int] | None,
        timestamp: str | None,
    ) -> CarparkAvailability:
        distance = 0.0
        if query_lat is not None and query_lng is not None:
            distance = haversine(query_lat, query_lng, info["lat"], info["lng"])
        total_lots = int(info["total_lots"])
        raw_id = carpark_id[len(URA_ID_PREFIX) :]
        live_available = availability.get(raw_id) if availability is not None else None
        has_live_availability = live_available is not None and timestamp is not None
        available_lots = live_available if live_available is not None else 0
        return CarparkAvailability(
            id=carpark_id,
            name=info["name"],
            address=info["name"],
            lat=info["lat"],
            lng=info["lng"],
            available_lots=available_lots,
            total_lots=total_lots,
            lot_types=(
                [LotTypeAvailability(lot_type="C", available_lots=available_lots, total_lots=total_lots)]
                if has_live_availability
                else []
            ),
            crowd_level=crowd_level(available_lots, total_lots) if has_live_availability else "unknown",
            is_sheltered=None,
            distance=round(distance),
            night_parking=None,
            car_park_type="CAR PARK",
            source=self.source_name,
            availability_timestamp=timestamp if has_live_availability else None,
        )

    async def list_nearby(self, lat: float, lng: float, radius: int) -> list[CarparkAvailability]:
        nearby = [
            (raw_id, info)
            for raw_id, info in self.lookup.items()
            if haversine(lat, lng, info["lat"], info["lng"]) <= radius
        ]
        if not nearby:
            return []
        availability, timestamp = await self._fetch_live("list_nearby", None)
        return [
            self._record(f"{URA_ID_PREFIX}{raw_id}", info, lat, lng, availability, timestamp)
            for raw_id, info in nearby
        ]

    async def get_by_id(
        self, carpark_id: str, lat: float | None, lng: float | None
    ) -> CarparkAvailability:
        normalized = carpark_id.upper()
        raw_id = normalized[len(URA_ID_PREFIX) :]
        info = self.lookup.get(raw_id)
        if info is None:
            raise CarparkNotFoundError(
                self.source_name,
                "get_by_id",
                carpark_id,
                f"URA carpark '{carpark_id}' not found",
            )
        availability, timestamp = await self._fetch_live("get_by_id", normalized)
        return self._record(normalized, info, lat, lng, availability, timestamp)
