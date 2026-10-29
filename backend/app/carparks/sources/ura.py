from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.carparks.errors import CarparkNotFoundError
from app.carparks.helpers import haversine
from app.carparks.models import CarparkAvailability


URA_ID_PREFIX = "URA_"


class UraSource:
    """Static URA locations and capacity; live availability is not assumed."""

    source_name = "ura"
    id_prefix = URA_ID_PREFIX

    def __init__(self, lookup: Mapping[str, dict]) -> None:
        self.lookup = lookup

    def _record(
        self,
        carpark_id: str,
        info: Mapping[str, Any],
        query_lat: float | None,
        query_lng: float | None,
    ) -> CarparkAvailability:
        distance = 0.0
        if query_lat is not None and query_lng is not None:
            distance = haversine(query_lat, query_lng, info["lat"], info["lng"])
        return CarparkAvailability(
            id=carpark_id,
            name=info["name"],
            address=info["name"],
            lat=info["lat"],
            lng=info["lng"],
            available_lots=0,
            total_lots=info["total_lots"],
            lot_types=[],
            crowd_level="unknown",
            is_sheltered=None,
            distance=round(distance),
            night_parking=None,
            car_park_type="CAR PARK",
            source=self.source_name,
            availability_timestamp=None,
        )

    async def list_nearby(self, lat: float, lng: float, radius: int) -> list[CarparkAvailability]:
        results: list[CarparkAvailability] = []
        for raw_id, info in self.lookup.items():
            if haversine(lat, lng, info["lat"], info["lng"]) <= radius:
                results.append(self._record(f"{URA_ID_PREFIX}{raw_id}", info, lat, lng))
        return results

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
        return self._record(normalized, info, lat, lng)
