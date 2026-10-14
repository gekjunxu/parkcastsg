from __future__ import annotations

from pydantic import BaseModel


class LotTypeAvailability(BaseModel):
    lot_type: str
    available_lots: int
    total_lots: int


class CarparkAvailability(BaseModel):
    id: str
    name: str
    address: str
    lat: float
    lng: float
    available_lots: int
    total_lots: int
    lot_types: list[LotTypeAvailability]
    crowd_level: str
    is_sheltered: bool | None
    distance: int
    night_parking: bool | None
    car_park_type: str
    source: str
    free_parking: str = "NO"
    short_term_parking: str = "WHOLE DAY"
    is_central: bool = False
    is_peak: bool = False
    weekdays_rate_1: str | None = None
    weekdays_rate_2: str | None = None
    saturday_rate: str | None = None
    sunday_ph_rate: str | None = None
    availability_timestamp: str | None = None
