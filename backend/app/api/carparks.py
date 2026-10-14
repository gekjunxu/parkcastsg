from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.carparks.errors import CarparkSourceError
from app.carparks.helpers import haversine
from app.carparks.models import CarparkAvailability
from app.carparks.service import build_default_service


router = APIRouter()
service = build_default_service()

# Compatibility export for callers that used the old private helper in tests.
_haversine = haversine


def _raise_source_error(error: CarparkSourceError) -> None:
    raise HTTPException(status_code=error.status_code, detail=error.detail) from error


@router.get("/carparks/all", response_model=list[CarparkAvailability])
async def get_all_carparks():
    try:
        return await service.all()
    except CarparkSourceError as exc:
        _raise_source_error(exc)


@router.get("/carparks/nearby", response_model=list[CarparkAvailability])
async def get_nearby_carparks(lat: float, lng: float, radius: int = 500):
    try:
        return await service.nearby(lat, lng, radius)
    except CarparkSourceError as exc:
        _raise_source_error(exc)


@router.get("/carparks/area", response_model=list[CarparkAvailability])
async def get_carparks_in_area(north: float, south: float, east: float, west: float):
    try:
        return await service.area(north, south, east, west)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except CarparkSourceError as exc:
        _raise_source_error(exc)


@router.get("/carparks/{carpark_id:path}", response_model=CarparkAvailability)
async def get_carpark(carpark_id: str, lat: float | None = None, lng: float | None = None):
    try:
        return await service.get_by_id(carpark_id, lat, lng)
    except CarparkSourceError as exc:
        _raise_source_error(exc)
