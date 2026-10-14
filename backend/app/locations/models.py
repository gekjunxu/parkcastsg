from __future__ import annotations

from pydantic import BaseModel


class LocationSuggestion(BaseModel):
    label: str
    address: str | None = None
    postal: str | None = None
    lat: float
    lng: float
