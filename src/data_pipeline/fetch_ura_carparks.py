"""Build the static URA carpark catalogue from the official GeoJSON export.

The export contains all URA parking places, including motorcycle-only places.
This catalogue keeps only places with car capacity and excludes PP codes already
present in the LTA static lookup so the runtime can merge the sources safely.

Usage:
    python fetch_ura_carparks.py [path/to/capacity.geojson]

Without an argument, the current data.gov.sg download is fetched first. Passing
a saved file makes review and regeneration possible without another request.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any, Iterable

DATASET_ID = "d_9bf8620ecfdc8a5f8f77e3f02160af5c"
POLL_DOWNLOAD_URL = (
    "https://api-open.data.gov.sg/v1/public/api/datasets/"
    f"{DATASET_ID}/poll-download"
)
REPO_ROOT = Path(__file__).resolve().parents[2]
LTA_CSV = REPO_ROOT / "backend" / "app" / "data" / "lta_carparks.csv"
OUTPUT_CSV = REPO_ROOT / "backend" / "app" / "data" / "ura_carparks.csv"


def build_ura_rows(
    features: Iterable[dict[str, Any]], existing_codes: set[str]
) -> list[dict[str, Any]]:
    """Return one row per new URA code with a positive car capacity."""
    rows: dict[str, dict[str, Any]] = {}
    for feature in features:
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties")
        geometry = feature.get("geometry")
        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            continue

        code = str(properties.get("PP_CODE", "")).strip().upper()
        name = str(properties.get("PARKING_PL", "")).strip()
        coordinates = geometry.get("coordinates")
        if not code or not name or code in existing_codes or not isinstance(coordinates, list):
            continue
        try:
            lng, lat = float(coordinates[0]), float(coordinates[1])
            total_lots = int(properties.get("NO_CAR", 0))
        except (IndexError, TypeError, ValueError):
            continue
        if total_lots <= 0 or code in rows:
            continue

        rows[code] = {
            "pp_code": code,
            "name": name,
            "lat": lat,
            "lng": lng,
            "total_lots": total_lots,
        }

    return [rows[code] for code in sorted(rows)]


def _load_lta_codes() -> set[str]:
    with LTA_CSV.open(encoding="utf-8") as handle:
        return {
            row.get("carpark_id", "").strip().upper()
            for row in csv.DictReader(handle)
            if row.get("carpark_id", "").strip()
        }


def _download_geojson() -> dict[str, Any]:
    import requests

    response = requests.get(POLL_DOWNLOAD_URL, timeout=30)
    response.raise_for_status()
    payload = response.json()
    download_url = payload.get("data", {}).get("url")
    if not isinstance(download_url, str) or not download_url:
        raise ValueError("data.gov.sg did not return a URA download URL")
    download = requests.get(download_url, timeout=30)
    download.raise_for_status()
    document = download.json()
    if not isinstance(document, dict) or not isinstance(document.get("features"), list):
        raise ValueError("URA download is not a GeoJSON FeatureCollection")
    return document


def _load_geojson(path: Path | None) -> dict[str, Any]:
    if path is None:
        return _download_geojson()
    with path.open(encoding="utf-8") as handle:
        document = json.load(handle)
    if not isinstance(document, dict) or not isinstance(document.get("features"), list):
        raise ValueError("URA input is not a GeoJSON FeatureCollection")
    return document


def write_rows(rows: list[dict[str, Any]], path: Path = OUTPUT_CSV) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["pp_code", "name", "lat", "lng", "total_lots"],
        )
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", nargs="?", type=Path)
    args = parser.parse_args()

    document = _load_geojson(args.source)
    rows = build_ura_rows(document["features"], _load_lta_codes())
    write_rows(rows)
    print(f"Saved {len(rows)} new URA carpark rows -> {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
