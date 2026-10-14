from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from app.carparks.errors import CarparkNotFoundError
from app.carparks.helpers import haversine, rate_field
from app.carparks.models import CarparkAvailability


SUPPLEMENTAL_ID_PREFIX = "SUPP_"


class SupplementalSource:
    source_name = "supplemental"

    def __init__(
        self,
        lookup: Mapping[str, dict],
        id_lookup: Mapping[str, str],
        rates: Callable[[str], Mapping[str, str] | None],
    ) -> None:
        self.lookup = lookup
        self.id_lookup = id_lookup
        self.rates = rates
        self._id_by_name = {norm_name: carpark_id for carpark_id, norm_name in id_lookup.items()}

    def owns_id(self, carpark_id: str) -> bool:
        return carpark_id.upper().startswith(SUPPLEMENTAL_ID_PREFIX)

    @staticmethod
    def _id_for(norm_name: str) -> str:
        return SUPPLEMENTAL_ID_PREFIX + norm_name.replace(" ", "_").upper()

    def _record(
        self,
        carpark_id: str,
        info: Mapping[str, Any],
        query_lat: float | None,
        query_lng: float | None,
    ) -> CarparkAvailability:
        name = info["name"]
        rate_values = self.rates(name) or {}
        distance = 0.0
        if query_lat is not None and query_lng is not None:
            distance = haversine(query_lat, query_lng, info["lat"], info["lng"])
        return CarparkAvailability(
            id=carpark_id,
            name=name,
            address=name,
            lat=info["lat"],
            lng=info["lng"],
            available_lots=0,
            total_lots=0,
            crowd_level="unknown",
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
        )

    async def list_nearby(self, lat: float, lng: float, radius: int) -> list[CarparkAvailability]:
        results: list[CarparkAvailability] = []
        for norm_name, info in self.lookup.items():
            distance = haversine(lat, lng, info["lat"], info["lng"])
            if distance > radius:
                continue
            carpark_id = self._id_by_name.get(norm_name, self._id_for(norm_name))
            results.append(self._record(carpark_id, info, lat, lng))
        return results

    async def get_by_id(
        self, carpark_id: str, lat: float | None, lng: float | None
    ) -> CarparkAvailability:
        normalized = carpark_id.upper()
        norm_name = self.id_lookup.get(normalized)
        if norm_name is None:
            raise CarparkNotFoundError(
                self.source_name,
                "get_by_id",
                carpark_id,
                f"Supplemental carpark '{carpark_id}' not found",
            )
        info = self.lookup.get(norm_name)
        if info is None:
            raise CarparkNotFoundError(
                self.source_name,
                "get_by_id",
                carpark_id,
                f"Supplemental carpark '{carpark_id}' not found",
            )
        return self._record(normalized, info, lat, lng)
