from __future__ import annotations

import asyncio
import os
from collections.abc import Sequence
from math import ceil, isfinite

from app.carparks.errors import CarparkNotFoundError
from app.carparks.helpers import canonicalise_name, haversine
from app.carparks.models import CarparkAvailability
from app.carparks.sources.base import CarparkSource
from app.carparks.sources.hdb import HdbSource
from app.carparks.sources.lta import LtaSource
from app.carparks.sources.supplemental import SupplementalSource
from app.carparks.sources.ura import UraSource
from app.data.carpark_lookup import CARPARK_LOOKUP
from app.data.lta_carpark_lookup import LTA_CARPARK_LOOKUP
from app.data.lta_rates_lookup import lookup_rate
from app.data.supplemental_carpark_lookup import SUPPLEMENTAL_CARPARK_LOOKUP, SUPPLEMENTAL_ID_LOOKUP
from app.data.ura_carpark_lookup import URA_CARPARK_LOOKUP


_SOURCE_PRIORITY = {"hdb": 0, "lta": 1, "ura": 2, "supplemental": 3}


class CarparkService:
    def __init__(self, sources: Sequence[CarparkSource]) -> None:
        self.sources = tuple(
            sorted(sources, key=lambda source: _SOURCE_PRIORITY.get(source.source_name, 99))
        )

    async def nearby(self, lat: float, lng: float, radius: int) -> list[CarparkAvailability]:
        source_results = await asyncio.gather(
            *(source.list_nearby(lat, lng, radius) for source in self.sources)
        )
        lta_names = {
            canonicalise_name(result.name)
            for source, results in zip(self.sources, source_results)
            if source.source_name == "lta"
            for result in results
        }

        seen: dict[str, CarparkAvailability] = {}
        for source, results in zip(self.sources, source_results):
            for result in results:
                if source.source_name == "supplemental" and canonicalise_name(result.name) in lta_names:
                    continue
                if result.id not in seen:
                    seen[result.id] = result
        return sorted(seen.values(), key=lambda result: result.distance)

    async def all(self) -> list[CarparkAvailability]:
        results = await self.nearby(1.3521, 103.8198, 100_000)
        return sorted(results, key=lambda result: result.id)

    async def area(
        self, north: float, south: float, east: float, west: float
    ) -> list[CarparkAvailability]:
        if not all(isfinite(value) for value in (north, south, east, west)) or not (
            -90 <= south < north <= 90 and -180 <= west < east <= 180
        ):
            raise ValueError("Invalid map bounds")
        if north - south > 0.12 or east - west > 0.12:
            raise ValueError("Zoom in to search this area")
        lat, lng = (north + south) / 2, (east + west) / 2
        radius = ceil(max(haversine(lat, lng, y, x) for y in (north, south) for x in (east, west)))
        candidates = await self.nearby(lat, lng, radius)
        return [
            result
            for result in candidates
            if south <= result.lat <= north and west <= result.lng <= east
        ]

    async def get_by_id(
        self, carpark_id: str, lat: float | None, lng: float | None
    ) -> CarparkAvailability:
        normalized = carpark_id.upper()
        for source in self.sources:
            if source.owns_id(normalized):
                return await source.get_by_id(normalized, lat, lng)
        raise CarparkNotFoundError(
            "service",
            "get_by_id",
            carpark_id,
            f"Carpark '{carpark_id}' not found",
        )


def build_default_service() -> CarparkService:
    return CarparkService(
        [
            HdbSource(CARPARK_LOOKUP),
            LtaSource(LTA_CARPARK_LOOKUP, lookup_rate, os.getenv("LTA_API_KEY") or ""),
            UraSource(URA_CARPARK_LOOKUP),
            SupplementalSource(SUPPLEMENTAL_CARPARK_LOOKUP, SUPPLEMENTAL_ID_LOOKUP, lookup_rate),
        ]
    )
