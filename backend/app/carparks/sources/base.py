from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.carparks.models import CarparkAvailability


@runtime_checkable
class CarparkSource(Protocol):
    source_name: str
    id_prefix: str | None

    async def list_nearby(
        self, lat: float, lng: float, radius: int
    ) -> list[CarparkAvailability]:
        ...

    async def get_by_id(
        self, carpark_id: str, lat: float | None, lng: float | None
    ) -> CarparkAvailability:
        ...
