from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.locations.errors import LocationServiceError
from app.locations.models import LocationSuggestion
from app.locations.onemap import OneMapClient


router = APIRouter()


def get_location_client(request: Request) -> OneMapClient:
    return request.app.state.onemap_client


@router.get("/locations/suggest", response_model=list[LocationSuggestion])
async def suggest_locations(
    q: str = Query(...),
    client: OneMapClient = Depends(get_location_client),
):
    query = q.strip()
    if not 2 <= len(query) <= 100:
        raise HTTPException(status_code=422, detail="Search query must be between 2 and 100 characters")
    try:
        return await client.search(query)
    except LocationServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
