from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

from app.carparks.models import CarparkRateSchedule


def _text(row: Mapping[str, Any], key: str) -> str | None:
    value = row.get(key)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _is_valid_time(value: str) -> bool:
    compact = re.fullmatch(r"([0-9]{2})([0-9]{2})", value)
    if compact:
        return int(compact.group(1)) <= 23 and int(compact.group(2)) <= 59

    clock = re.fullmatch(
        r"([0-9]{1,2})(?:\.([0-9]{1,2}))?\s*(AM|PM|MN|MIDNIGHT)",
        value,
        re.IGNORECASE,
    )
    if not clock:
        return False
    hour = int(clock.group(1))
    minute = int(clock.group(2) or 0)
    suffix = clock.group(3).upper()
    if minute > 59:
        return False
    if suffix in {"AM", "PM"}:
        return 1 <= hour <= 12
    return 0 <= hour <= 12


def parse_ura_rate_schedules(
    entries: list[Mapping[str, Any]],
) -> dict[str, list[CarparkRateSchedule]]:
    schedules: dict[str, list[CarparkRateSchedule]] = {}
    for row in entries:
        if not isinstance(row, Mapping):
            continue

        pp_code = _text(row, "ppCode")
        vehicle_type = _text(row, "vehCat")
        start_time = _text(row, "startTime")
        end_time = _text(row, "endTime")
        if (
            not pp_code
            or not vehicle_type
            or not start_time
            or not end_time
            or not _is_valid_time(start_time)
            or not _is_valid_time(end_time)
        ):
            continue

        schedule = CarparkRateSchedule(
            vehicle_type=vehicle_type,
            start_time=start_time,
            end_time=end_time,
            weekday_rate=_text(row, "weekdayRate"),
            weekday_min=_text(row, "weekdayMin"),
            saturday_rate=_text(row, "satdayRate"),
            saturday_min=_text(row, "satdayMin"),
            sunday_ph_rate=_text(row, "sunPHRate"),
            sunday_ph_min=_text(row, "sunPHMin"),
            remarks=_text(row, "remarks"),
        )
        schedules.setdefault(pp_code.upper(), []).append(schedule)

    return schedules


def _minutes(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*min", value, re.IGNORECASE)
    return float(match.group(1)) if match else None


def _is_zero_rate(value: str) -> bool:
    try:
        return float(value.replace("$", "").replace(",", "").strip()) == 0
    except ValueError:
        return False


def _format_charge(rate: str | None, minimum: str | None) -> str | None:
    if not rate:
        return None
    duration = _minutes(minimum)
    if _is_zero_rate(rate) and duration == 0:
        return "Free parking"
    if re.search(r"\bper\b|/", rate, re.IGNORECASE):
        return rate

    if duration is None or duration <= 0:
        return rate
    if duration == 60:
        return f"{rate} per hr"
    display_duration = int(duration) if duration.is_integer() else duration
    return f"{rate} per {display_duration:g} mins"


def _project_segments(
    schedules: Sequence[CarparkRateSchedule],
    rate_field: str,
    minimum_field: str,
) -> str | None:
    segments: list[str] = []
    for schedule in schedules:
        charge = _format_charge(
            getattr(schedule, rate_field),
            getattr(schedule, minimum_field),
        )
        if charge is None:
            continue
        segments.append(f"{schedule.start_time}-{schedule.end_time}: {charge}")
    return "\n".join(segments) or None


def project_ura_car_rates(
    schedules: Sequence[CarparkRateSchedule],
) -> dict[str, str | None]:
    car_schedules = [schedule for schedule in schedules if schedule.vehicle_type.upper() == "C"]
    return {
        "weekdays_rate_1": _project_segments(car_schedules, "weekday_rate", "weekday_min"),
        "weekdays_rate_2": None,
        "saturday_rate": _project_segments(car_schedules, "saturday_rate", "saturday_min"),
        "sunday_ph_rate": _project_segments(car_schedules, "sunday_ph_rate", "sunday_ph_min"),
    }
