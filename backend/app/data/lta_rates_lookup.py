"""
LTA / URA carpark rates lookup table.

Loads CarparkRates.csv at import time and exposes ``LTA_RATES_LOOKUP``,
a dict keyed by normalised carpark name for fast O(1) matching against
LTA DataMall ``Development`` strings.

Matching strategy
-----------------
Both keys are lower-cased and have internal whitespace collapsed.  A
secondary "stripped" index is also built that removes parenthetical
suffixes (e.g. "(Multi-Storey Car Park)") so that the CSV entry
"Bukit Timah Plaza (Multi-Storey Car Park)" also matches a shorter
Development name "Bukit Timah Plaza".
"""
from __future__ import annotations

import csv
import re
from pathlib import Path

_DATA_DIR = Path(__file__).parent
_RATES_CSV = _DATA_DIR / "CarparkRates.csv"

# Rate record shape (all strings — raw free-text from the CSV)
RateRecord = dict[str, str]


def _normalise(name: str) -> str:
    """Collapse whitespace and lower-case a carpark name."""
    return re.sub(r"\s+", " ", name.lower().strip())


def _strip_parens(name: str) -> str:
    """Remove trailing parenthetical content, e.g. ' (Multi-Storey Car Park)'."""
    return re.sub(r"\s*\(.*\)\s*$", "", name).strip()


def canonicalise_name(name: str) -> str:
    """Return a conservative comparison key for formatting-only differences.

    This handles punctuation, spacing, and the common ``Bt`` abbreviation
    without using fuzzy matching, which could silently attach the wrong price
    to a similarly named development.
    """
    words = re.findall(r"[a-z0-9]+", name.lower())
    expanded = ["bukit" if word == "bt" else word for word in words]
    if expanded and expanded[0] == "the":
        expanded = expanded[1:]
    return "".join(expanded)


def _load() -> tuple[
    dict[str, RateRecord],
    dict[str, RateRecord],
    dict[str, RateRecord],
]:
    """Return exact, parenthesis-stripped, and canonical indexes.

    primary_index  — keyed by full normalised CSV carpark name
    stripped_index — keyed by normalised name with parens removed;
                     only populated when the stripped key differs from
                     the full key to avoid shadowing the primary index.
    """
    primary: dict[str, RateRecord] = {}
    stripped: dict[str, RateRecord] = {}
    canonical_candidates: dict[str, list[RateRecord]] = {}

    if not _RATES_CSV.exists():
        return primary, stripped, {}

    with open(_RATES_CSV, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = row.get("carpark", "").strip()
            if not name:
                continue

            record: RateRecord = {
                "weekdays_rate_1": row.get("weekdays_rate_1", "").strip(),
                "weekdays_rate_2": row.get("weekdays_rate_2", "").strip(),
                "saturday_rate": row.get("saturday_rate", "").strip(),
                "sunday_ph_rate": row.get("sunday_publicholiday_rate", "").strip(),
            }

            full_key = _normalise(name)
            primary[full_key] = record

            stripped_key = _normalise(_strip_parens(name))
            if stripped_key != full_key:
                # Only add if not already covered by a shorter CSV entry
                stripped.setdefault(stripped_key, record)

            canonical_key = canonicalise_name(name)
            if canonical_key:
                canonical_candidates.setdefault(canonical_key, []).append(record)

    # Only keep unambiguous canonical keys. If two rate rows collapse to the
    # same key, exact/stripped matching remains available but canonical matching
    # refuses to guess.
    canonical = {
        key: records[0]
        for key, records in canonical_candidates.items()
        if len(records) == 1
    }
    return primary, stripped, canonical


_PRIMARY, _STRIPPED, _CANONICAL = _load()


def lookup_rate(development: str) -> RateRecord | None:
    """Return the rate record for a development name, or None if not found.

    ``development`` is the raw value from the LTA DataMall API; it is
    normalised internally before matching.  Raw "-" / empty values in the
    returned dict are left as-is; callers should use ``_rate_field()`` to
    convert them to ``None`` before storing.
    """
    key = _normalise(development)
    return (
        _PRIMARY.get(key)
        or _STRIPPED.get(key)
        or _CANONICAL.get(canonicalise_name(development))
    )


# Convenience export expected by carparks.py
LTA_RATES_LOOKUP = _PRIMARY  # exposed for tests / debug; prefer lookup_rate() at call sites
