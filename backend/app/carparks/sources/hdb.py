from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

import httpx

from app.carparks.errors import CarparkNotFoundError, CarparkSourceError
from app.carparks.helpers import crowd_level, haversine, normalize_lot_types
from app.carparks.models import CarparkAvailability


HDB_AVAILABILITY_URL = "https://api.data.gov.sg/v1/transport/carpark-availability"
logger = logging.getLogger(__name__)


class HdbSource:
    source_name = "hdb"

    def __init__(
        self,
        lookup: Mapping[str, dict],
        availability_url: str = HDB_AVAILABILITY_URL,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.lookup = lookup
        self.availability_url = availability_url
        self.transport = transport

    def owns_id(self, carpark_id: str) -> bool:
        normalized = carpark_id.upper()
        return not normalized.startswith(("LTA_", "SUPP_"))

    async def _fetch_payload(self, operation: str, carpark_id: str | None) -> dict[str, Any]:
        client_kwargs: dict[str, Any] = {"timeout": 10.0}
        if self.transport is not None:
            client_kwargs["transport"] = self.transport
        try:
            async with httpx.AsyncClient(**client_kwargs) as client:
                response = await client.get(self.availability_url)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            self._log_error(operation, carpark_id, str(exc))
            raise CarparkSourceError(
                self.source_name,
                operation,
                carpark_id,
                502,
                f"HDB API error: {exc}",
            ) from exc

        try:
            payload = response.json()
        except ValueError as exc:
            self._log_error(operation, carpark_id, "invalid JSON")
            raise CarparkSourceError(
                self.source_name,
                operation,
                carpark_id,
                502,
                f"Unexpected HDB API response: invalid JSON ({exc})",
            ) from exc

        if not isinstance(payload, dict):
            return self._bad_payload(operation, carpark_id, "top-level JSON is not an object")
        items = payload.get("items")
        if not isinstance(items, list) or not items:
            return self._bad_payload(operation, carpark_id, "'items' list is missing or empty")
        first_item = items[0]
        if not isinstance(first_item, dict) or "carpark_data" not in first_item:
            return self._bad_payload(operation, carpark_id, "'carpark_data' is missing")
        if not isinstance(first_item["carpark_data"], list):
            return self._bad_payload(operation, carpark_id, "'carpark_data' is not a list")
        return payload

    def _bad_payload(self, operation: str, carpark_id: str | None, detail: str) -> dict[str, Any]:
        self._log_error(operation, carpark_id, detail)
        raise CarparkSourceError(
            self.source_name,
            operation,
            carpark_id,
            502,
            f"Unexpected HDB API response: {detail}",
        )

    def _log_error(self, operation: str, carpark_id: str | None, detail: str) -> None:
        logger.error(
            "carpark source=%s operation=%s carpark_id=%s detail=%s",
            self.source_name,
            operation,
            carpark_id or "-",
            detail,
        )

    def _timestamp(self, payload: dict[str, Any]) -> str | None:
        items = payload["items"]
        first_item = items[0]
        timestamp = first_item.get("timestamp")
        return timestamp if isinstance(timestamp, str) else None

    def _record(
        self,
        cp: dict[str, Any],
        info: Mapping[str, Any],
        query_lat: float | None,
        query_lng: float | None,
        timestamp: str | None,
    ) -> CarparkAvailability:
        cp_no = str(cp.get("carpark_number", ""))
        cp_info_list = cp.get("carpark_info", [])
        if not isinstance(cp_info_list, list):
            cp_info_list = []
        lot_types = normalize_lot_types(cp_info_list)
        available = sum(item.available_lots for item in lot_types)
        total = sum(item.total_lots for item in lot_types)
        distance = 0.0
        if query_lat is not None and query_lng is not None:
            distance = haversine(query_lat, query_lng, info["lat"], info["lng"])
        return CarparkAvailability(
            id=cp_no,
            name=f"HDB {cp_no}",
            address=info["address"],
            lat=info["lat"],
            lng=info["lng"],
            available_lots=available,
            total_lots=total,
            lot_types=lot_types,
            crowd_level=crowd_level(available, total),
            is_sheltered=info["is_sheltered"],
            distance=round(distance),
            night_parking=info["night_parking"],
            car_park_type=info.get("car_park_type", ""),
            source=self.source_name,
            free_parking=info.get("free_parking", "NO"),
            short_term_parking=info.get("short_term_parking", "WHOLE DAY"),
            is_central=info.get("is_central", False),
            is_peak=info.get("is_peak", False),
            availability_timestamp=timestamp,
        )

    async def list_nearby(self, lat: float, lng: float, radius: int) -> list[CarparkAvailability]:
        operation = "list_nearby"
        payload = await self._fetch_payload(operation, None)
        first_item = payload["items"][0]
        timestamp = self._timestamp(payload)
        results: list[CarparkAvailability] = []
        for cp in first_item["carpark_data"]:
            if not isinstance(cp, dict):
                continue
            cp_no = str(cp.get("carpark_number", ""))
            info = self.lookup.get(cp_no)
            if info is None:
                continue
            distance = haversine(lat, lng, info["lat"], info["lng"])
            if distance > radius:
                continue
            results.append(self._record(cp, info, lat, lng, timestamp))
        return results

    async def get_by_id(
        self, carpark_id: str, lat: float | None, lng: float | None
    ) -> CarparkAvailability:
        normalized = carpark_id.upper()
        info = self.lookup.get(normalized)
        if info is None:
            raise CarparkNotFoundError(
                self.source_name,
                "get_by_id",
                carpark_id,
                f"Carpark '{carpark_id}' not found",
            )

        payload = await self._fetch_payload("get_by_id", normalized)
        first_item = payload["items"][0]
        cp = next(
            (
                item
                for item in first_item["carpark_data"]
                if isinstance(item, dict)
                and str(item.get("carpark_number", "")).upper() == normalized
            ),
            None,
        )
        if cp is None:
            detail = f"HDB API did not return availability for carpark '{carpark_id}'"
            self._log_error("get_by_id", normalized, detail)
            raise CarparkSourceError(self.source_name, "get_by_id", normalized, 502, detail)
        return self._record(cp, info, lat, lng, self._timestamp(payload))
