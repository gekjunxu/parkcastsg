# Carpark Catalogue Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the bundled HDB carpark catalogue from the current official export, add the official URA capacity catalogue and missing Pasir Ris Mall entry, and ensure the existing static rate snapshot is never silently replaced by unverified or older values.

**Architecture:** Keep the current source boundaries. HDB metadata and coordinates remain the two mirrored CSV snapshots used by the runtime and data pipeline; URA receives a separate `PP_CODE`-keyed static source; Pasir Ris Mall remains a curated supplemental record with its rate in `CarparkRates.csv`. Rate data is treated as a separately reviewed snapshot: back it up before the refresh, change only the source-checked Pasir Ris Mall row, and document review scope/date rather than claiming the full catalogue is current.

**Tech Stack:** CSV snapshots, Python maintenance scripts, `pyproj` for the existing SVY21-to-WGS84 conversion, FastAPI lookup tests, and the official data.gov.sg / Pasir Ris Mall pages.

**Spec:** `docs/superpowers/specs/2026-10-28-carpark-catalog-refresh-design.md`

## Global Constraints

- Use the current official HDB dataset resource `d_23f946fa557947f93a8043bbef41dd09` as the metadata source.
- Update both `src/data_pipeline/` and `backend/app/data/` HDB snapshots together; do not leave the runtime and maintenance copies divergent.
- Preserve the pre-refresh `CarparkRates.csv` byte-for-byte in the temporary backup and do not bulk-refresh unrelated rate rows.
- Use the official Pasir Ris Mall tariff page for the new rate and OneMap for its coordinates.
- Do not add live URA availability or rate integration; the authenticated URA API needs a separate access key/token and the static source must work without credentials.
- Review generated diffs and verify the backend lookup path before claiming completion.

## Review Focus

- The HDB export may add/remove IDs and alter addresses or SVY21 coordinates; check counts and set differences before copying it into runtime data.
- Coordinate generation must use the existing EPSG:3414 to EPSG:4326 path and must be reproducible on a clean maintenance install.
- Rate changes must be limited to the verified Pasir Ris Mall row; the pre-refresh hash must remain recoverable.
- The supplemental record and rate name must match the existing lookup normalization so the mall is discoverable by name and returned with coordinates/rates.

---

## Task 1: Make the existing HDB refresh path reproducible

**Files:** `src/data_pipeline/generate_coords.py`, `src/data_pipeline/requirements.txt`

- [x] Add the already-required `pyproj` dependency to the maintenance requirements with a compatible pinned version.
- [x] Make `generate_coords.py` resolve `HDBCarparkInformation.csv` relative to the script instead of relying on the caller's working directory/case-insensitive filesystem.
- [x] Keep the script's existing output contract (`carpark_id,latitude,longitude`) unchanged.

## Task 2: Refresh HDB snapshots from the official export

**Files:** `src/data_pipeline/HDBCarparkInformation.csv`, `src/data_pipeline/hdb_clean_coords.csv`, `backend/app/data/HDBCarparkInformation.csv`, `backend/app/data/hdb_clean_coords.csv`

- [x] Fetch the current official data.gov.sg HDB carpark information export and normalize it to the existing column order and names.
- [x] Compare old/new row counts, added IDs, removed IDs, and changed records; retain the comparison as the review evidence for the refresh.
- [x] Generate the coordinate snapshot with the maintenance converter, then copy the exact same metadata and coordinate files into `backend/app/data/`.
- [x] Assert the two copies have identical bytes and matching ID sets before running the application tests.

## Task 3: Add Pasir Ris Mall without aging the rate catalogue

**Files:** `backend/app/data/CarparkRates.csv`, `backend/app/data/supplemental_carparks.csv`, `src/data_pipeline/README.md`

- [x] Copy the existing rate CSV to the already-created pre-refresh backup and verify its SHA-256 before editing.
- [x] Add one `East` rate row for `Pasir Ris Mall` using the official current tariff wording, including weekday/weekend differences, overnight bands, and the 15-minute grace period.
- [x] Add the OneMap coordinate for `Pasir Ris Mall` (`1.373824377794677, 103.9487488736156`) to the supplemental catalogue.
- [x] Document the official source URL and review date, and state clearly that only the Pasir Ris Mall row was source-checked in this refresh; keep the existing four verified corrections and their citations intact.

## Task 4: Add focused regression checks and verify

**Files:** `backend/tests/test_rate_lookup.py`, `backend/tests/test_supplemental_source.py`

- [x] Extend existing tests only enough to assert that Pasir Ris Mall resolves through the supplemental lookup and returns the expected location/rate row.
- [x] Run the HDB snapshot consistency/ID audit and confirm the rate backup hash is unchanged.
- [x] Run backend unit tests, Python compilation, and the existing rate coverage audit.
- [x] Inspect the final diff for accidental rate rewrites, duplicate mall rows, or stale/divergent mirrored HDB files.

## Execution Notes

- Prefer native/local execution because the CSV snapshots and lookup tests are coupled and the change does not benefit from parallel agents.
- If the official export or dependency install is unavailable, stop before replacing the snapshots and report the exact blocker; keep the rate backup and existing runtime data intact.
