# Carpark Source Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate HDB, LTA, and supplemental carpark behavior into independently testable adapters while preserving the API contract and fixing slash-containing supplemental detail URLs first.

**Architecture:** Make the slash-route change as a standalone, tested first commit. Then move shared models/helpers into a source-neutral carpark package, give each source an adapter that returns `CarparkAvailability` directly, and put only cross-source coordination in `CarparkService`. Keep `backend/app/api/carparks.py` as a thin FastAPI layer.

**Tech Stack:** Python 3.13, FastAPI 0.141.1, Pydantic, httpx 0.28.1, unittest, FastAPI `TestClient`.

**Spec:** `docs/superpowers/specs/2026-10-14-carpark-source-adapters-design.md`

## Global Constraints

- Backend-only refactor; keep the frontend `NearbyCarpark` shape and `source` field unchanged.
- Preserve endpoints, query parameters, response fields, defaults, source labels, ordering, and existing carpark IDs.
- Missing record → `404`; HDB upstream failure → `502`; LTA upstream failure → static fallback; supplemental data is static-only.
- Do not introduce availability caching, retries, stale-data serving, or cache invalidation in this refactor.
- Adapters return `CarparkAvailability` directly and have no FastAPI dependencies or cross-source imports.
- Keep unrelated working-tree changes out of the refactor.

## Review Focus

- Raw and encoded `%2F` supplemental detail URLs, with and without `/parkcastsit`, must return the same record; Task 1 and Task 7 test this.
- Static `/all`, `/nearby`, and `/area` routes must precede the path-converter detail route and frontend catch-all; Task 7 tests route ordering.
- LTA must prefilter static locations before a live upstream request, and live zero must differ from missing availability; Task 4 tests both.
- Supplemental/LTA duplicate suppression must occur only in list aggregation while direct supplemental detail remains resolvable; Task 6 tests both.
- Existing bounds validation, inclusive area edges, defaults, ordering, and HDB-first priority must remain unchanged; Tasks 6–7 pin these behaviors.

---

### Task 1: Fix slash-containing detail routing first

**Files:**
- Modify: `backend/app/api/carparks.py:652`
- Create: `backend/tests/test_carpark_api.py`

**Interfaces:**
- Change only the detail decorator to `@router.get("/carparks/{carpark_id:path}", response_model=CarparkAvailability)`; keep the route after `/all`, `/nearby`, and `/area`.
- The route must pass `SUPP_KEPPEL_BAY_TOWER_/_HARBOURFRONT_TOWER_ONE` unchanged to the existing lookup path.

- [ ] **Step 1: Write failing route tests**

  Use `TestClient` and patch the existing supplemental detail helper with a known `CarparkAvailability`. Test both the raw slash URL and the encoded `%2F` URL under `/api/v1`, then repeat one encoded request under `/parkcastsit/api/v1` while temporarily setting `app.main.app_base_path` to `/parkcastsit`. Assert HTTP `200`, the unchanged ID, and the stub call's exact ID.

- [ ] **Step 2: Run the focused tests and verify the expected failure**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_carpark_api.py -v`

  Expected: FAIL with `404` against the current `{carpark_id}` route because the slash creates another path segment.

- [ ] **Step 3: Implement the minimal path-converter change**

  Change only the decorator path to `{carpark_id:path}`. Do not refactor the handler yet; this commit proves the routing fix independently.

- [ ] **Step 4: Run the focused tests and verify the route fix**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_carpark_api.py -v`

  Expected: PASS for raw, encoded, and `/parkcastsit` requests.

- [ ] **Step 5: Commit the independently tested fix**

  ```powershell
  git add -- backend/app/api/carparks.py backend/tests/test_carpark_api.py
  git commit -m "fix: route slash-containing carpark IDs"
  ```

### Task 2: Establish shared domain types, helpers, and source errors

**Files:**
- Create: `backend/app/carparks/__init__.py`
- Create: `backend/app/carparks/models.py`
- Create: `backend/app/carparks/helpers.py`
- Create: `backend/app/carparks/errors.py`
- Create: `backend/app/carparks/sources/__init__.py`
- Create: `backend/app/carparks/sources/base.py`
- Modify: `backend/app/data/lta_rates_lookup.py`
- Test: `backend/tests/test_carpark_foundation.py`

**Interfaces:**
- Move `CarparkAvailability` and `LotTypeAvailability` unchanged into `carparks.models`.
- Expose `haversine`, `crowd_level`, `crowd_level_absolute`, `rate_field`, `normalize_lot_types`, and `canonicalise_name` from `carparks.helpers`; keep `lta_rates_lookup.canonicalise_name` as a compatibility re-export.
- Define `CarparkSource` with `source_name: str`, `owns_id(carpark_id: str) -> bool`, `list_nearby(lat: float, lng: float, radius: int) -> list[CarparkAvailability]`, and `get_by_id(carpark_id: str, lat: float | None, lng: float | None) -> CarparkAvailability`.
- Define `CarparkSourceError(source_name: str, operation: str, carpark_id: str | None, status_code: int, detail: str)` and `CarparkNotFoundError` as its `404` subclass.

- [ ] **Step 1: Write failing foundation tests**

  Test model field names/defaults, helper behavior copied from the existing module, canonical name compatibility, source protocol shape, and error fields/statuses.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_carpark_foundation.py -v`

  Expected: FAIL because the new domain modules do not exist.

- [ ] **Step 3: Implement the shared modules and compatibility re-export**

  Keep the helpers independent of FastAPI and data-source modules. Do not add caching or source-specific branches to the shared package.

- [ ] **Step 4: Run the focused tests and verify they pass**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_carpark_foundation.py -v`

  Expected: PASS.

- [ ] **Step 5: Commit the foundation**

  ```powershell
  git add -- backend/app/carparks backend/app/data/lta_rates_lookup.py backend/tests/test_carpark_foundation.py
  git commit -m "refactor: add carpark source domain types"
  ```

### Task 3: Extract the HDB source adapter

**Files:**
- Create: `backend/app/carparks/sources/hdb.py`
- Test: `backend/tests/test_hdb_source.py`

**Interfaces:**
- `HdbSource(lookup: Mapping[str, dict], availability_url: str = HDB_AVAILABILITY_URL, transport: httpx.AsyncBaseTransport | None = None)` implements `CarparkSource`.
- `HdbSource.list_nearby(...)` and `get_by_id(...)` return `CarparkAvailability` directly and preserve metadata joins, lot types, crowd levels, radius filtering, timestamps, and defaults.
- `HdbSource.owns_id()` accepts IDs that are not prefixed `LTA_` or `SUPP_`.

- [ ] **Step 1: Write failing HDB adapter tests**

  With `httpx.MockTransport`, test a valid payload, failed upstream response, malformed JSON/shape, detail lookup, and `assertLogs` content containing source, operation, and carpark ID for a detail failure. Assert `CarparkSourceError(status_code=502)` for upstream failures.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_hdb_source.py -v`

  Expected: FAIL because `HdbSource` is not implemented.

- [ ] **Step 3: Implement `HdbSource`**

  Move only HDB request, parsing, metadata joining, and detail logic. Use the injected transport for tests and keep the existing ten-second request timeout. Do not add a cache.

- [ ] **Step 4: Run the focused tests and verify they pass**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_hdb_source.py -v`

  Expected: PASS.

- [ ] **Step 5: Commit the HDB adapter**

  ```powershell
  git add -- backend/app/carparks/sources/hdb.py backend/tests/test_hdb_source.py
  git commit -m "refactor: extract HDB carpark source"
  ```

### Task 4: Extract the LTA source adapter with prefiltering and fallback

**Files:**
- Create: `backend/app/carparks/sources/lta.py`
- Test: `backend/tests/test_lta_source.py`

**Interfaces:**
- `LtaSource(lookup: Mapping[str, dict], rates: Callable[[str], Mapping[str, str] | None], api_key: str, availability_url: str = LTA_AVAILABILITY_URL, transport: httpx.AsyncBaseTransport | None = None)` implements `CarparkSource`.
- `LtaSource.owns_id()` accepts only `LTA_` IDs.
- `LtaSource.list_nearby(...)` filters the static lookup by radius before any live request; if no static candidate is nearby, it must not create a live upstream request.
- `LtaSource` returns static `CarparkAvailability` records with `crowd_level="unknown"` when the key is missing or upstream data is invalid/unavailable. A live `AvailableLots=0` entry remains `crowd_level="full"`, distinct from a missing entry.

- [ ] **Step 1: Write failing LTA adapter tests**

  Cover no API key, no nearby candidates with a transport-call counter, successful live data with multiple lot entries, live zero, missing live record, failed/invalid live data fallback, HDB-agency exclusion, unknown ID, detail lookup, and warning logs containing source/operation.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_lta_source.py -v`

  Expected: FAIL because `LtaSource` is not implemented.

- [ ] **Step 3: Implement `LtaSource`**

  Move LTA-specific static lookup, prefilter, live parsing, rate enrichment, fallback behavior, detail lookup, and logging. Do not add a cache.

- [ ] **Step 4: Run the focused tests and verify they pass**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_lta_source.py -v`

  Expected: PASS.

- [ ] **Step 5: Commit the LTA adapter**

  ```powershell
  git add -- backend/app/carparks/sources/lta.py backend/tests/test_lta_source.py
  git commit -m "refactor: extract LTA carpark source"
  ```

### Task 5: Extract the supplemental source without cross-source suppression

**Files:**
- Create: `backend/app/carparks/sources/supplemental.py`
- Test: `backend/tests/test_supplemental_source.py`

**Interfaces:**
- `SupplementalSource(lookup: Mapping[str, dict], id_lookup: Mapping[str, str], rates: Callable[[str], Mapping[str, str] | None])` implements `CarparkSource`.
- `SupplementalSource.owns_id()` accepts only `SUPP_` IDs.
- `list_nearby(...)` returns all in-range supplemental records with static-only unknown availability; it does not import LTA lookup names or suppress another source.
- `get_by_id(...)` resolves `SUPP_KEPPEL_BAY_TOWER_/_HARBOURFRONT_TOWER_ONE` exactly as emitted by list results.

- [ ] **Step 1: Write failing supplemental tests**

  Assert the exact slash-containing ID and rates, static-only defaults, no cross-source imports/suppression, and `CarparkNotFoundError` for an unknown ID.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_supplemental_source.py -v`

  Expected: FAIL because `SupplementalSource` is not implemented.

- [ ] **Step 3: Implement `SupplementalSource`**

  Move supplemental lookup, ID generation/lookup, rate enrichment, and static detail behavior. Preserve all existing IDs, including punctuation and `/`; do not introduce a renamed/sanitized ID scheme.

- [ ] **Step 4: Run the focused tests and verify they pass**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_supplemental_source.py -v`

  Expected: PASS.

- [ ] **Step 5: Commit the supplemental adapter**

  ```powershell
  git add -- backend/app/carparks/sources/supplemental.py backend/tests/test_supplemental_source.py
  git commit -m "refactor: extract supplemental carpark source"
  ```

### Task 6: Add the cross-source aggregation service

**Files:**
- Create: `backend/app/carparks/service.py`
- Test: `backend/tests/test_carpark_service.py`

**Interfaces:**
- `CarparkService(sources: Sequence[CarparkSource])` stores explicit HDB-first, LTA-second, supplemental-third source order.
- `async nearby(lat: float, lng: float, radius: int) -> list[CarparkAvailability]` asks each adapter for nearby records, applies ID deduplication with HDB-first priority, suppresses supplemental records whose canonical names match an LTA result, and sorts by distance.
- `async all() -> list[CarparkAvailability]` uses Singapore center `(1.3521, 103.8198)` and radius `100_000`, then sorts by ID as before.
- `async area(north: float, south: float, east: float, west: float) -> list[CarparkAvailability]` preserves bounds validation, enclosing-radius calculation, and inclusive edge filtering.
- `async get_by_id(carpark_id: str, lat: float | None, lng: float | None) -> CarparkAvailability` dispatches by `owns_id()` and never applies list-only duplicate suppression.
- `build_default_service() -> CarparkService` wires the existing lookup tables, rates function, and environment LTA key.

- [ ] **Step 1: Write failing service tests**

  Use fake adapters returning `CarparkAvailability` records to assert HDB-first ID priority, distance ordering, LTA-name suppression of supplemental list records, direct supplemental detail resolution despite suppression, all-carpark constants, area inclusive edges, invalid/oversized bounds, and source dispatch/not-found behavior.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_carpark_service.py -v`

  Expected: FAIL because `CarparkService` is not implemented.

- [ ] **Step 3: Implement `CarparkService` and `build_default_service()`**

  Keep source parsing out of the service. The only source-aware aggregation rules are HDB-first ID priority and LTA-versus-supplemental canonical-name suppression for list responses.

- [ ] **Step 4: Run the focused tests and verify they pass**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_carpark_service.py -v`

  Expected: PASS.

- [ ] **Step 5: Commit the service**

  ```powershell
  git add -- backend/app/carparks/service.py backend/tests/test_carpark_service.py
  git commit -m "refactor: add carpark aggregation service"
  ```

### Task 7: Thin the API layer and complete compatibility coverage

**Files:**
- Modify: `backend/app/api/carparks.py`
- Modify: `backend/tests/test_map_performance.py`
- Modify: `backend/tests/test_carpark_api.py`

**Interfaces:**
- Keep `router` and `/all`, `/nearby`, `/area`, and `/carparks/{carpark_id:path}` paths unchanged and in that order.
- Instantiate one module-level `service = build_default_service()`; routes call `service.all()`, `service.nearby(...)`, `service.area(...)`, and `service.get_by_id(...)`.
- Translate `CarparkSourceError` and `CarparkNotFoundError` into the existing HTTP status/detail responses.
- Keep query validation and response models at the API boundary; remove source-specific constants, imports, helpers, and fetch/detail implementations.

- [ ] **Step 1: Extend failing compatibility tests**

  Update area tests to patch `carparks_api.service.nearby` or `service.area` rather than deleted source functions. Add assertions for route order relative to the frontend catch-all, inclusive area edges, unchanged response defaults/source labels/order, and raw/encoded `/parkcastsit` slash URLs using the real service boundary stub.

- [ ] **Step 2: Run the focused API tests and verify failures identify missing service wiring**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_carpark_api.py backend/tests/test_map_performance.py -v`

  Expected: FAIL until routes are wired to `CarparkService` and errors are translated.

- [ ] **Step 3: Replace the API implementation with thin service-backed routes**

  Preserve route order, validation, response model, error statuses/details, and the path converter from Task 1. Ensure the frontend catch-all remains after the API routes.

- [ ] **Step 4: Run the focused API tests and verify they pass**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_carpark_api.py backend/tests/test_map_performance.py -v`

  Expected: PASS.

- [ ] **Step 5: Commit the API refactor and compatibility coverage**

  ```powershell
  git add -- backend/app/api/carparks.py backend/tests/test_carpark_api.py backend/tests/test_map_performance.py
  git commit -m "refactor: route carpark API through source service"
  ```

### Task 8: Run the complete verification suite

**Files:**
- No new files; verify all files from Tasks 1–7.

- [ ] **Step 1: Run the complete backend suite**

  Run: `$env:PYTHONPATH='backend'; python -m unittest discover -s backend/tests -p "test*.py"`

  Expected: all existing and new backend tests pass with zero failures.

- [ ] **Step 2: Run frontend tests to verify the unchanged contract consumer**

  Run from `frontend`: `npm test`

  Expected: all frontend tests pass; no frontend source-specific changes are required.

- [ ] **Step 3: Review the final diff and whitespace**

  Run: `git diff --check`. Confirm `backend/app/api/carparks.py` contains only routing, validation, service calls, and error translation; confirm no availability cache or unrelated files were introduced.

- [ ] **Step 4: Confirm the final verification state**

  Expected: raw and encoded staging-path detail tests pass, all compatibility tests pass, and the final diff contains only the approved adapter refactor and route fix.
