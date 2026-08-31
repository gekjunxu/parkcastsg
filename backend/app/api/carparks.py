from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from math import atan2, cos, radians, sin, sqrt

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.data.carpark_lookup import CARPARK_LOOKUP
from app.data.lta_carpark_lookup import LTA_CARPARK_LOOKUP
from app.data.lta_rates_lookup import lookup_rate
from app.data.lta_rates_lookup import canonicalise_name
from app.data.supplemental_carpark_lookup import SUPPLEMENTAL_CARPARK_LOOKUP, LTA_DEVELOPMENT_NAMES, SUPPLEMENTAL_ID_LOOKUP

router = APIRouter()

HDB_AVAILABILITY_URL = "https://api.data.gov.sg/v1/transport/carpark-availability"
LTA_AVAILABILITY_URL = "https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2"

LTA_API_KEY = os.getenv("LTA_API_KEY") or ""  # empty string is treated as "not configured"

# Prefix used to distinguish LTA carpark IDs from HDB carpark numbers
LTA_ID_PREFIX = "LTA_"

# Agencies already covered by the HDB dataset — skip to avoid duplicates
_HDB_AGENCIES: frozenset[str] = frozenset({"HDB"})


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


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
    crowd_level: str  # "low" | "medium" | "high" | "full" | "unknown"
    is_sheltered: bool | None
    distance: int  # metres from the query point
    night_parking: bool | None
    car_park_type: str  # e.g. "MULTI-STOREY CAR PARK", "SURFACE CAR PARK"
    source: str  # "hdb" | "lta" | "supplemental"
    # HDB pricing metadata (populated for HDB carparks; defaults for others)
    free_parking: str = "NO"
    short_term_parking: str = "WHOLE DAY"
    is_central: bool = False
    is_peak: bool = False
    # Rate fields — populated for LTA/supplemental carparks when CarparkRates.csv has a match;
    # None means "no data available" (will render as "see operator" in the UI).
    weekdays_rate_1: str | None = None
    weekdays_rate_2: str | None = None
    saturday_rate: str | None = None
    sunday_ph_rate: str | None = None
    # Availability timestamp from upstream when available; otherwise fetch-time.
    availability_timestamp: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return distance in metres between two WGS84 points."""
    R = 6_371_000  # Earth radius in metres
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lng2 - lng1)
    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlambda / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


def _crowd_level(available: int, total: int) -> str:
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


def _crowd_level_absolute(available: int) -> str:
    """Crowd level based on absolute lot count (used when total lots are unknown)."""
    if available == 0:
        return "full"
    if available > 50:
        return "low"
    if available > 20:
        return "medium"
    return "high"


def _rate_field(value: str) -> str | None:
    """Return the rate string, or None if the field contains no useful data."""
    v = value.strip()
    return None if v in ("-", "") else v


def _normalize_lot_types(cp_info_list: list[dict]) -> list[LotTypeAvailability]:
    """
    Preserve the upstream lot-type breakdown so the frontend can show
    availability per transport category instead of only a single summed total.
    """
    return [
        LotTypeAvailability(
            lot_type=str(item.get("lot_type", "")),
            available_lots=int(item.get("lots_available", 0)),
            total_lots=int(item.get("total_lots", 0)),
        )
        for item in cp_info_list
    ]


# ---------------------------------------------------------------------------
# Data-source helpers
# ---------------------------------------------------------------------------


async def _fetch_hdb_carparks(lat: float, lng: float, radius: int) -> list[CarparkAvailability]:
    """Fetch HDB carparks within radius from data.gov.sg."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(HDB_AVAILABILITY_URL)
            resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"HDB API error: {exc}") from exc

    try:
        data = resp.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unexpected HDB API response: invalid JSON ({exc})",
        ) from exc

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=502,
            detail="Unexpected HDB API response: top-level JSON is not an object",
        )

    items = data.get("items")
    if not isinstance(items, list) or not items:
        raise HTTPException(
            status_code=502,
            detail="Unexpected HDB API response: 'items' list is missing or empty",
        )

    first_item = items[0]
    if not isinstance(first_item, dict) or "carpark_data" not in first_item:
        raise HTTPException(
            status_code=502,
            detail="Unexpected HDB API response: 'carpark_data' is missing",
        )

    carpark_data = first_item["carpark_data"]
    hdb_timestamp = first_item.get("timestamp") if isinstance(first_item.get("timestamp"), str) else None
    if not isinstance(carpark_data, list):
        raise HTTPException(
            status_code=502,
            detail="Unexpected HDB API response: 'carpark_data' is not a list",
        )

    results: list[CarparkAvailability] = []
    for cp in carpark_data:
        cp_no: str = cp.get("carpark_number", "")
        info = CARPARK_LOOKUP.get(cp_no)
        if info is None:
            continue  # not in our HDB info dataset

        dist = _haversine(lat, lng, info["lat"], info["lng"])
        if dist > radius:
            continue

        cp_info_list: list[dict] = cp.get("carpark_info", [])
        lot_types = _normalize_lot_types(cp_info_list)
        available = sum(int(x.get("lots_available", 0)) for x in cp_info_list)
        total = sum(int(x.get("total_lots", 0)) for x in cp_info_list)

        results.append(
            CarparkAvailability(
                id=cp_no,
                name=f"HDB {cp_no}",
                address=info["address"],
                lat=info["lat"],
                lng=info["lng"],
                available_lots=available,
                total_lots=total,
                lot_types=lot_types,
                crowd_level=_crowd_level(available, total),
                is_sheltered=info["is_sheltered"],
                distance=round(dist),
                night_parking=info["night_parking"],
                car_park_type=info.get("car_park_type", ""),
                source="hdb",
                free_parking=info.get("free_parking", "NO"),
                short_term_parking=info.get("short_term_parking", "WHOLE DAY"),
                is_central=info.get("is_central", False),
                is_peak=info.get("is_peak", False),
                availability_timestamp=hdb_timestamp,
            )
        )

    return results

async def _fetch_lta_carparks(lat: float, lng: float, radius: int) -> list[CarparkAvailability]:
    """Fetch non-HDB carparks from LTA DataMall within radius.

    Uses the static ``LTA_CARPARK_LOOKUP`` for geometry filtering so that the
    LTA availability API is only called when at least one LTA carpark falls
    within the requested radius — and never called at all if the static CSV
    has not been generated yet.

    Static locations are still returned with unknown availability when:
    - ``LTA_CARPARK_LOOKUP`` is empty (CSV not yet generated)
    - No LTA carparks lie within ``radius``
    - ``LTA_API_KEY`` is unset
    - The upstream availability request fails
    """
    if not LTA_CARPARK_LOOKUP:
        return []

    # 1. Geometry-filter from in-memory static lookup — no network call needed.
    nearby: dict[str, dict] = {
        cp_id: info
        for cp_id, info in LTA_CARPARK_LOOKUP.items()
        if _haversine(lat, lng, info["lat"], info["lng"]) <= radius
    }
    if not nearby:
        return []  # nothing in range — skip the API call entirely

    availability: dict[str, int] = {}
    lta_fetch_timestamp: str | None = None

    if not LTA_API_KEY:
        logging.warning("LTA_API_KEY not configured; returning static LTA locations")
    else:
        # 2. Fetch live availability for all carparks (API returns the full dataset).
        lta_fetch_timestamp = datetime.now(timezone.utc).isoformat()
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    LTA_AVAILABILITY_URL,
                    headers={"AccountKey": LTA_API_KEY, "accept": "application/json"},
                )
                resp.raise_for_status()
        except httpx.HTTPError as exc:
            logging.warning(
                f"Failed to fetch LTA carpark availability ({exc}); using static LTA locations"
            )
        else:
            try:
                data = resp.json()
            except ValueError:
                logging.warning(
                    "LTA carpark availability returned invalid JSON; using static LTA locations"
                )
            else:
                if not isinstance(data, dict) or not isinstance(data.get("value"), list):
                    logging.warning(
                        "LTA carpark availability had an unexpected shape; using static LTA locations"
                    )
                else:
                    # 3. Build an availability dict: raw CarParkID -> available car lots.
                    #    Sum across multiple LotType="C" entries for the same CarParkID.
                    for entry in data["value"]:
                        if not isinstance(entry, dict):
                            continue
                        if entry.get("Agency", "") in _HDB_AGENCIES:
                            continue
                        if entry.get("LotType", "") != "C":
                            continue
                        cp_id = str(entry.get("CarParkID", "")).strip()
                        if cp_id:
                            availability[cp_id] = availability.get(cp_id, 0) + int(entry.get("AvailableLots", 0))

    # 4. Join static metadata with live availability counts. If the live feed
    # was unavailable, the static entry remains useful for location and rate
    # discovery while its availability is explicitly marked as unknown.
    results: list[CarparkAvailability] = []
    for cp_id, info in nearby.items():
        dist = _haversine(lat, lng, info["lat"], info["lng"])
        available = availability.get(cp_id)
        has_live_availability = available is not None and lta_fetch_timestamp is not None
        available_lots = available if available is not None else 0
        development = info["development"]
        prefixed_id = f"{LTA_ID_PREFIX}{cp_id}"
        rates = lookup_rate(development) or {}
        results.append(
            CarparkAvailability(
                id=prefixed_id,
                name=development or f"Carpark {cp_id}",
                address=development or f"Carpark {cp_id}",
                lat=info["lat"],
                lng=info["lng"],
                available_lots=available_lots,
                total_lots=0,  # LTA API does not provide total lots
                crowd_level=(
                    _crowd_level_absolute(available_lots)
                    if has_live_availability
                    else "unknown"
                ),
                is_sheltered=None,  # LTA API does not expose shelter info
                distance=round(dist),
                night_parking=None,  # LTA API does not expose night-parking info
                car_park_type="CAR PARK",
                source="lta",
                lot_types=[],
                weekdays_rate_1=_rate_field(rates.get("weekdays_rate_1", "")),
                weekdays_rate_2=_rate_field(rates.get("weekdays_rate_2", "")),
                saturday_rate=_rate_field(rates.get("saturday_rate", "")),
                sunday_ph_rate=_rate_field(rates.get("sunday_ph_rate", "")),
                availability_timestamp=(
                    lta_fetch_timestamp if has_live_availability else None
                ),
            )
        )

    return results


async def _get_hdb_carpark(
    carpark_id: str, lat: float | None, lng: float | None
) -> CarparkAvailability:
    info = CARPARK_LOOKUP.get(carpark_id.upper())
    if info is None:
        raise HTTPException(status_code=404, detail=f"Carpark '{carpark_id}' not found")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(HDB_AVAILABILITY_URL)
            resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"HDB API error: {exc}") from exc

    payload = resp.json()
    first_item = payload.get("items", [{}])[0] if isinstance(payload.get("items"), list) else {}
    hdb_timestamp = first_item.get("timestamp") if isinstance(first_item, dict) and isinstance(first_item.get("timestamp"), str) else None
    carpark_data: list[dict] = first_item.get("carpark_data", []) if isinstance(first_item, dict) else []
    cp = next(
        (c for c in carpark_data if c.get("carpark_number") == carpark_id.upper()), None
    )
    if cp is None:
        raise HTTPException(
            status_code=502,
            detail=f"HDB API did not return availability for carpark '{carpark_id}'",
        )

    cp_info_list: list[dict] = cp.get("carpark_info", [])
    lot_types = _normalize_lot_types(cp_info_list)
    available = sum(int(lot.get("lots_available", 0)) for lot in cp_info_list)
    total = sum(int(lot.get("total_lots", 0)) for lot in cp_info_list)

    dist = 0
    if lat is not None and lng is not None:
        dist = _haversine(lat, lng, info["lat"], info["lng"])

    return CarparkAvailability(
        id=carpark_id,
        name=f"HDB {carpark_id}",
        address=info["address"],
        lat=info["lat"],
        lng=info["lng"],
        available_lots=available,
        total_lots=total,
        lot_types=lot_types,
        crowd_level=_crowd_level(available, total),
        is_sheltered=info["is_sheltered"],
        distance=round(dist),
        night_parking=info["night_parking"],
        car_park_type=info.get("car_park_type", ""),
        source="hdb",
        free_parking=info.get("free_parking", "NO"),
        short_term_parking=info.get("short_term_parking", "WHOLE DAY"),
        is_central=info.get("is_central", False),
        is_peak=info.get("is_peak", False),
        availability_timestamp=hdb_timestamp,
    )


async def _get_lta_carpark(
    carpark_id: str, lat: float | None, lng: float | None
) -> CarparkAvailability:
    """Fetch a single LTA carpark by its prefixed ID (e.g. 'LTA_B0020').

    Metadata is read from the static ``LTA_CARPARK_LOOKUP``; only live
    availability is fetched from the LTA API.
    """
    raw_id = carpark_id[len(LTA_ID_PREFIX):]  # strip the LTA_ prefix

    info = LTA_CARPARK_LOOKUP.get(raw_id)
    if info is None:
        raise HTTPException(
            status_code=404,
            detail=f"LTA carpark '{carpark_id}' not found (not in static lookup — run fetch_lta_carparks.py)",
        )

    if not LTA_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="LTA service unavailable: LTA_API_KEY not configured",
        )

    try:
        lta_fetch_timestamp = datetime.now(timezone.utc).isoformat()
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                LTA_AVAILABILITY_URL,
                headers={"AccountKey": LTA_API_KEY, "accept": "application/json"},
            )
            resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"LTA API error: {exc}") from exc

    try:
        data = resp.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"LTA API returned invalid JSON: {exc}") from exc

    if not isinstance(data, dict) or not isinstance(data.get("value"), list):
        raise HTTPException(status_code=502, detail="Unexpected LTA API response shape")

    # Preserve the distinction between a real zero and a carpark omitted from
    # the latest live feed.
    matching_entries = [
        e
        for e in data["value"]
        if isinstance(e, dict)
        and str(e.get("CarParkID", "")).strip() == raw_id
        and e.get("LotType") == "C"
    ]
    has_live_availability = bool(matching_entries)
    available = sum(int(e.get("AvailableLots", 0)) for e in matching_entries)

    development = info["development"]
    rates = lookup_rate(development) or {}

    dist = 0
    if lat is not None and lng is not None:
        dist = _haversine(lat, lng, info["lat"], info["lng"])

    return CarparkAvailability(
        id=carpark_id,
        name=development or f"Carpark {raw_id}",
        address=development or f"Carpark {raw_id}",
        lat=info["lat"],
        lng=info["lng"],
        available_lots=available,
        total_lots=0,  # LTA API does not provide total lots
        crowd_level=(
            _crowd_level_absolute(available)
            if has_live_availability
            else "unknown"
        ),
        is_sheltered=None,  # LTA API does not expose shelter info
        distance=round(dist),
        night_parking=None,  # LTA API does not expose night-parking info
        car_park_type="CAR PARK",
        source="lta",
        lot_types=[],
        weekdays_rate_1=_rate_field(rates.get("weekdays_rate_1", "")),
        weekdays_rate_2=_rate_field(rates.get("weekdays_rate_2", "")),
        saturday_rate=_rate_field(rates.get("saturday_rate", "")),
        sunday_ph_rate=_rate_field(rates.get("sunday_ph_rate", "")),
        availability_timestamp=(
            lta_fetch_timestamp if has_live_availability else None
        ),
    )


def _fetch_supplemental_carparks(lat: float, lng: float, radius: int) -> list[CarparkAvailability]:
    """Return carparks from supplemental_carparks.csv within radius.

    These are carparks sourced from CarparkRates.csv that are not tracked by
    the HDB or LTA DataMall datasets.  Because no live-availability API exists
    for them, crowd_level is set to "unknown" and available/total lots are 0.

    Any entry whose normalised name appears in ``LTA_DEVELOPMENT_NAMES`` is
    suppressed to avoid showing a duplicate once lta_carparks.csv is populated.
    """
    results: list[CarparkAvailability] = []

    for norm_name, info in SUPPLEMENTAL_CARPARK_LOOKUP.items():
        if canonicalise_name(norm_name) in LTA_DEVELOPMENT_NAMES:
            continue  # already covered by the LTA DataMall dataset

        dist = _haversine(lat, lng, info["lat"], info["lng"])
        if dist > radius:
            continue

        name = info["name"]
        rates = lookup_rate(name) or {}
        cp_id = f"SUPP_{norm_name.replace(' ', '_').upper()}"

        results.append(
            CarparkAvailability(
                id=cp_id,
                name=name,
                address=name,
                lat=info["lat"],
                lng=info["lng"],
                available_lots=0,
                total_lots=0,
                crowd_level="unknown",
                is_sheltered=None,
                distance=round(dist),
                night_parking=None,
                car_park_type="CAR PARK",
                source="supplemental",
                lot_types=[],
                weekdays_rate_1=_rate_field(rates.get("weekdays_rate_1", "")),
                weekdays_rate_2=_rate_field(rates.get("weekdays_rate_2", "")),
                saturday_rate=_rate_field(rates.get("saturday_rate", "")),
                sunday_ph_rate=_rate_field(rates.get("sunday_ph_rate", "")),
            )
        )

    return results


def _get_supplemental_carpark(
    carpark_id: str, lat: float | None, lng: float | None
) -> CarparkAvailability:
    """Return a supplemental carpark by its SUPP_-prefixed ID."""
    norm_name = SUPPLEMENTAL_ID_LOOKUP.get(carpark_id)
    if norm_name is None:
        raise HTTPException(
            status_code=404,
            detail=f"Supplemental carpark '{carpark_id}' not found",
        )

    info = SUPPLEMENTAL_CARPARK_LOOKUP[norm_name]
    name = info["name"]
    rates = lookup_rate(name) or {}

    dist = 0.0
    if lat is not None and lng is not None:
        dist = _haversine(lat, lng, info["lat"], info["lng"])

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
        distance=round(dist),
        night_parking=None,
        car_park_type="CAR PARK",
        source="supplemental",
        lot_types=[],
        weekdays_rate_1=_rate_field(rates.get("weekdays_rate_1", "")),
        weekdays_rate_2=_rate_field(rates.get("weekdays_rate_2", "")),
        saturday_rate=_rate_field(rates.get("saturday_rate", "")),
        sunday_ph_rate=_rate_field(rates.get("sunday_ph_rate", "")),
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/carparks/all", response_model=list[CarparkAvailability])
async def get_all_carparks():
    """
    Return ALL HDB, LTA, and supplemental carparks across Singapore with live
    availability where available.  Distances are computed relative to Singapore's
    geographic centre (1.3521, 103.8198).  Intended for the full-map explorer
    view where every carpark should be rendered on the map up-front.
    """
    # Use Singapore geographic centre + 100 km radius → captures every carpark
    SG_LAT = 1.3521
    SG_LNG = 103.8198
    SG_RADIUS = 100_000  # 100 km

    hdb_results, lta_results = await asyncio.gather(
        _fetch_hdb_carparks(SG_LAT, SG_LNG, SG_RADIUS),
        _fetch_lta_carparks(SG_LAT, SG_LNG, SG_RADIUS),
    )
    supplemental_results = _fetch_supplemental_carparks(SG_LAT, SG_LNG, SG_RADIUS)
    # Deduplicate by ID — HDB results take priority over LTA/supplemental
    # for the same carpark number (HDB has richer availability data).
    seen: dict[str, CarparkAvailability] = {}
    for cp in hdb_results + lta_results + supplemental_results:
        if cp.id not in seen:
            seen[cp.id] = cp
    results = sorted(seen.values(), key=lambda x: x.id)
    return results


@router.get("/carparks/nearby", response_model=list[CarparkAvailability])
async def get_nearby_carparks(lat: float, lng: float, radius: int = 500):
    """
    Return HDB, LTA, and supplemental carparks within `radius` metres of
    (lat, lng) with live availability where available.  Without an LTA key,
    static LTA locations are still returned with unknown availability.
    """
    hdb_results, lta_results = await asyncio.gather(
        _fetch_hdb_carparks(lat, lng, radius),
        _fetch_lta_carparks(lat, lng, radius),
    )
    supplemental_results = _fetch_supplemental_carparks(lat, lng, radius)
    # Deduplicate by ID — HDB results take priority over LTA/supplemental.
    seen: dict[str, CarparkAvailability] = {}
    for cp in hdb_results + lta_results + supplemental_results:
        if cp.id not in seen:
            seen[cp.id] = cp
    results = sorted(seen.values(), key=lambda x: x.distance)
    return results


@router.get("/carparks/{carpark_id}", response_model=CarparkAvailability)
async def get_carpark(carpark_id: str, lat: float | None = None, lng: float | None = None):
    """
    Return a single carpark's live availability by ID.
    HDB carparks use their carpark number (e.g. 'ACB').
    LTA carparks use the 'LTA_' prefix (e.g. 'LTA_B0020').
    Supplemental carparks use the 'SUPP_' prefix.
    """
    normalised = carpark_id.upper()
    if normalised.startswith(LTA_ID_PREFIX):
        return await _get_lta_carpark(normalised, lat, lng)
    if normalised.startswith("SUPP_"):
        return _get_supplemental_carpark(normalised, lat, lng)
    return await _get_hdb_carpark(normalised, lat, lng)
