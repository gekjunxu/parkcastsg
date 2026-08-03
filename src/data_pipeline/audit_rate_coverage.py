"""Report how much of the bundled carpark catalogue has published rate data."""

from __future__ import annotations

import csv
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.data.lta_carpark_lookup import LTA_CARPARK_LOOKUP  # noqa: E402
from app.data.lta_rates_lookup import lookup_rate  # noqa: E402
from app.data.supplemental_carpark_lookup import (  # noqa: E402
    SUPPLEMENTAL_CARPARK_LOOKUP,
)


def csv_row_count(path: Path) -> int:
    with path.open(encoding="utf-8", newline="") as handle:
        return sum(1 for _ in csv.DictReader(handle))


def main() -> None:
    rates_file = BACKEND_DIR / "app" / "data" / "CarparkRates.csv"
    rate_rows = csv_row_count(rates_file)
    matched_lta = [
        info["development"]
        for info in LTA_CARPARK_LOOKUP.values()
        if lookup_rate(info["development"]) is not None
    ]
    unmatched_lta = sorted(
        info["development"]
        for info in LTA_CARPARK_LOOKUP.values()
        if lookup_rate(info["development"]) is None
    )

    print(f"Published rate rows: {rate_rows}")
    print(f"LTA developments with a matched rate: {len(matched_lta)}/{len(LTA_CARPARK_LOOKUP)}")
    print(f"Supplemental rate-only carparks: {len(SUPPLEMENTAL_CARPARK_LOOKUP)}")
    print("\nLTA developments still missing a rate match:")
    for development in unmatched_lta:
        print(f"- {development}")


if __name__ == "__main__":
    main()
