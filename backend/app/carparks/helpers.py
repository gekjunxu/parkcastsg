from __future__ import annotations

import re
from math import atan2, cos, radians, sin, sqrt

from app.carparks.models import LotTypeAvailability


def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return distance in metres between two WGS84 points."""
    radius = 6_371_000
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lng2 - lng1)
    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlambda / 2) ** 2
    return radius * 2 * atan2(sqrt(a), sqrt(1 - a))


def crowd_level(available: int, total: int) -> str:
    if total == 0:
        return "full"
    ratio = available / total
    if available == 0:
        return "full"
    if ratio > 0.5:
        return "low"
    if ratio > 0.2:
        return "medium"
    return "high"


def crowd_level_absolute(available: int) -> str:
    if available == 0:
        return "full"
    if available > 50:
        return "low"
    if available > 20:
        return "medium"
    return "high"


def rate_field(value: str) -> str | None:
    value = value.strip()
    return None if value in ("-", "") else value


def normalize_lot_types(cp_info_list: list[dict]) -> list[LotTypeAvailability]:
    return [
        LotTypeAvailability(
            lot_type=str(item.get("lot_type", "")),
            available_lots=int(item.get("lots_available", 0)),
            total_lots=int(item.get("total_lots", 0)),
        )
        for item in cp_info_list
    ]


def canonicalise_name(name: str) -> str:
    """Return a conservative comparison key for formatting-only differences."""
    words = re.findall(r"[a-z0-9]+", name.lower())
    expanded = ["bukit" if word == "bt" else word for word in words]
    if expanded and expanded[0] == "the":
        expanded = expanded[1:]
    return "".join(expanded)
