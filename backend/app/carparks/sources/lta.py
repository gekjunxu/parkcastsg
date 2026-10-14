from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from typing import Any

import httpx

from app.carparks.errors import CarparkNotFoundError
from app.carparks.helpers import crowd_level_absolute, haversine, rate_field
from app.carparks.models import CarparkAvailability


LTA_AVAILABILITY_URL = "https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2"
LTA_ID_PREFIX = "LTA_"
_HDB_AGENCIES: frozenset[str] = frozenset({"HDB"})
logger = logging.getLogger(__name__)


class LtaSource:
    source_name = "lta"

    def __init__(
        self,
        lookup: Mapping[str, dict],
        rates: Callable[[str], Mapping[str, str] | None],
        api_key: str,
        availability_url: str = LTA_AVAILABILITY_URL,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.lookup = lookup
        self.rates = rates
        self.api_key = api_key
        self.availability_url = availability_url
        self.transport = transport

    def owns_id(self, carpark_id: str) -> bool:
        return carpark_id.upper().startswith(LTA_ID_PREFIX)

    def _log_warning(self, operation: str, carpark_id: str | None, detail: str) -> None:
        logger.warning(
            "carpark source=%s operation=%s carpark_id=%s detail=%s",
            self.source_name,
            operation,
            carpark_id or "-",
            detail,
        )

    async def _fetch_live(
        self, operation: str, carpark_id: str | None
    ) -> tuple[dict[str, int], str | None]:
        if not self.api_key:
            self._log_warning(operation, carpark_id, "LTA_API_KEY not configured; using static details")
            return {}, None

        client_kwargs: dict[str, Any] = {"timeout": 10.0}
        if self.transport is not None:
            client_kwargs["transport"] = self.transport
        try:
            async with httpx.AsyncClient(**client_kwargs) as client:
                response = await client.get(
                    self.availability_url,
                    headers={"AccountKey": self.api_key, "accept": "application/json"},
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            self._log_warning(operation, carpark_id, f"upstream failure ({exc}); using static details")
            return {}, None

        try:
            payload = response.json()
        except ValueError:
            self._log_warning(operation, carpark_id, "invalid JSON; using static details")
            return {}, None
        if not isinstance(payload, dict) or not isinstance(payload.get("value"), list):
            self._log_warning(operation, carpark_id, "unexpected response shape; using static details")
            return {}, None

        availability: dict[str, int] = {}
        for entry in payload["value"]:
            if not isinstance(entry, dict):
                continue
            if entry.get("Agency", "") in _HDB_AGENCIES:
                continue
            if entry.get("LotType", "") != "C":
                continue
            raw_id = str(entry.get("CarParkID", "")).strip()
            if not raw_id:
                continue
            try:
                available = int(entry.get("AvailableLots", 0))
            except (TypeError, ValueError):
                self._log_warning(operation, carpark_id, f"invalid availability for {raw_id}")
                continue
            availability[raw_id] = availability.get(raw_id, 0) + available
        return availability, datetime.now(timezone.utc).isoformat()

    def _record(
        self,
        prefixed_id: str,
        raw_id: str,
        info: Mapping[str, Any],
        query_lat: float | None,
        query_lng: float | None,
        availability: Mapping[str, int],
        timestamp: str | None,
    ) -> CarparkAvailability:
        live_available = availability.get(raw_id)
        has_live_availability = live_available is not None and timestamp is not None
        available_lots = live_available if live_available is not None else 0
        development = info.get("development", "")
        rate_values = self.rates(development) or {}
        distance = 0.0
        if query_lat is not None and query_lng is not None:
            distance = haversine(query_lat, query_lng, info["lat"], info["lng"])
        return CarparkAvailability(
            id=prefixed_id,
            name=development or f"Carpark {raw_id}",
            address=development or f"Carpark {raw_id}",
            lat=info["lat"],
            lng=info["lng"],
            available_lots=available_lots,
            total_lots=0,
            crowd_level=(crowd_level_absolute(available_lots) if has_live_availability else "unknown"),
            is_sheltered=None,
            distance=round(distance),
            night_parking=None,
            car_park_type="CAR PARK",
            source=self.source_name,
            lot_types=[],
            weekdays_rate_1=rate_field(rate_values.get("weekdays_rate_1", "")),
            weekdays_rate_2=rate_field(rate_values.get("weekdays_rate_2", "")),
            saturday_rate=rate_field(rate_values.get("saturday_rate", "")),
            sunday_ph_rate=rate_field(rate_values.get("sunday_ph_rate", "")),
            availability_timestamp=(timestamp if has_live_availability else None),
        )

    async def list_nearby(self, lat: float, lng: float, radius: int) -> list[CarparkAvailability]:
        nearby = {
            raw_id: info
            for raw_id, info in self.lookup.items()
            if haversine(lat, lng, info["lat"], info["lng"]) <= radius
        }
        if not nearby:
            return []
        availability, timestamp = await self._fetch_live("list_nearby", None)
        return [
            self._record(f"{LTA_ID_PREFIX}{raw_id}", raw_id, info, lat, lng, availability, timestamp)
            for raw_id, info in nearby.items()
        ]

    async def get_by_id(
        self, carpark_id: str, lat: float | None, lng: float | None
    ) -> CarparkAvailability:
        normalized = carpark_id.upper()
        raw_id = normalized[len(LTA_ID_PREFIX):]
        info = self.lookup.get(raw_id)
        if info is None:
            raise CarparkNotFoundError(
                self.source_name,
                "get_by_id",
                carpark_id,
                f"LTA carpark '{carpark_id}' not found (not in static lookup — run fetch_lta_carparks.py)",
            )
        availability, timestamp = await self._fetch_live("get_by_id", normalized)
        return self._record(normalized, raw_id, info, lat, lng, availability, timestamp)
