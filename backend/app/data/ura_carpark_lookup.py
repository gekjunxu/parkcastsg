"""Static URA carpark lookup built from the official capacity export."""
from __future__ import annotations

import csv
from pathlib import Path


_DATA_DIR = Path(__file__).parent
_CSV = _DATA_DIR / "ura_carparks.csv"


def _load() -> dict[str, dict]:
    lookup: dict[str, dict] = {}
    if not _CSV.exists():
        return lookup

    with _CSV.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            code = row.get("pp_code", "").strip().upper()
            name = row.get("name", "").strip()
            if not code or not name:
                continue
            try:
                lookup[code] = {
                    "name": name,
                    "lat": float(row["lat"]),
                    "lng": float(row["lng"]),
                    "total_lots": int(row["total_lots"]),
                }
            except (KeyError, TypeError, ValueError):
                continue
    return lookup


URA_CARPARK_LOOKUP: dict[str, dict] = _load()
