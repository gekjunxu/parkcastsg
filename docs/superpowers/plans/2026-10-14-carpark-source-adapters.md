# Carpark Source Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split HDB, LTA, and supplemental carpark behavior into independently testable adapters while preserving the API contract and fixing slash-containing supplemental detail URLs.

**Architecture:** Keep shared response models and geometry helpers in a carpark domain package. Give each data source one adapter implementing a common protocol, and place multi-source fetching, deduplication, source selection, and area filtering in `CarparkService`. Leave `backend/app/api/carparks.py` as a thin FastAPI layer, including a path converter for IDs containing `/`.

**Tech Stack:** Python 3.13, FastAPI 0.141.1, Pydantic, httpx 0.28.1, unittest, FastAPI `TestClient`.

**Spec:** `docs/superpowers/specs/2026-10-14-carpark-source-adapters-design.md`

## Global Constraints

- Backend-only refactor; keep the frontend `NearbyCarpark` shape and `source` field unchanged.
- Preserve existing endpoints, query parameters, response fields, and source labels (`hdb`, `lta`, `supplemental`).
- Preserve source fallback behavior: HDB failures are API errors; LTA can return static locations without live availability; supplemental data is static-only.
- Do not add third-party dependencies.
- Keep existing carpark IDs unchanged, including IDs containing `/`.
- Keep unrelated working-tree changes out of the refactor.

## Review Focus

- A supplemental ID containing `/` must route to its detail adapter and return `200`; pin this in the API regression test in Task 6.
- An unset or failing LTA API key must preserve static LTA results with `unknown` availability; pin this in Task 3.
- A malformed or failed HDB upstream response must produce the existing `502` behavior; pin this in Task 2.
- Duplicate IDs from multiple sources must retain deterministic HDB-first priority; pin this in Task 5.
- Invalid or oversized map bounds must not trigger upstream calls; retain and update the area tests in Task 6.

---

### Task 1: Establish shared carpark domain types and source protocol

**Files:**
- Create: `backend/app/carparks/__init__.py`
- Create: `backend/app/carparks/models.py`
- Create: `backend/app/carparks/helpers.py`
- Create: `backend/app/carparks/errors.py`
- Create: `backend/app/carparks/sources/__init__.py`
- Create: `backend/app/carparks/sources/base.py`
- Test: `backend/tests/test_carpark_foundation.py`

**Interfaces:**
- `CarparkAvailability` and `LotTypeAvailability` move unchanged from `backend/app/api/carparks.py` to `carparks.models`.
- `haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float`, `crowd_level(available: int, total: int) -> str`, `crowd_level_absolute(available: int) -> str`, `rate_field(value: str) -> str | None`, and `normalize_lot_types(items: list[dict]) -> list[LotTypeAvailability]` live in `carparks.helpers`.
- `CarparkSource` protocol defines `source_name: str`, `owns_id(carpark_id: str) -> bool`, `list_nearby(lat: float, lng: float, radius: int) -> list[CarparkAvailability]`, and `get_by_id(carpark_id: str, lat: float | None, lng: float | None) -> CarparkAvailability`.
- `CarparkSourceError` carries `source_name`, `status_code`, and `detail`; `CarparkNotFoundError` subclasses it with `status_code=404` for source-neutral lookup failures.

- [ ] **Step 1: Write failing foundation tests**

  Test model serialization preserves the existing JSON field names and defaults. Test `haversine` returns approximately 0 for identical points and a positive distance for separated points. Test each helper's existing crowd/rate/lot-type behavior.

- [ ] **Step 2: Run the focused tests and verify they fail for missing modules/functions**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_carpark_foundation.py -v`

  Expected: FAIL because the new domain modules do not exist yet.

- [ ] **Step 3: Implement the shared models, helpers, errors, and protocol**

  Copy behavior exactly from the existing module, remove FastAPI dependencies from the new domain package, and keep the source protocol free of HTTP request/response types.

- [ ] **Step 4: Run the focused tests and verify they pass**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_carpark_foundation.py -v`

  Expected: PASS.

- [ ] **Step 5: Commit the foundation**

  ```powershell
  git add -- backend/app/carparks backend/tests/test_carpark_foundation.py
  git commit -m "refactor: add carpark source domain types"
  ```

### Task 2: Extract the HDB source adapter

**Files:**
- Create: `backend/app/carparks/sources/hdb.py`
- Test: `backend/tests/test_hdb_source.py`

**Interfaces:**
- `HdbSource(lookup: Mapping[str, dict], availability_url: str = HDB_AVAILABILITY_URL, transport: httpx.AsyncBaseTransport | None = None)` implements `CarparkSource`.
- `HdbSource.list_nearby(...)` preserves current HDB metadata joins, lot-type totals, crowd-level calculation, radius filtering, and timestamp handling.
- `HdbSource.get_by_id(...)` preserves current HDB detail behavior and error statuses without importing FastAPI.

- [ ] **Step 1: Write failing adapter tests**

  Use `httpx.MockTransport` to test a valid HDB payload, a failed upstream response, malformed JSON/shape, and a detail lookup. Assert the same `CarparkAvailability` fields and `CarparkSourceError(status_code=502)` behavior currently exposed by the API.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_hdb_source.py -v`

  Expected: FAIL because `HdbSource` is not implemented.

- [ ] **Step 3: Implement `HdbSource`**

  Move only HDB upstream access, parsing, metadata joining, and detail resolution from `carparks.py`. Use the injected transport for tests and retain the ten-second timeout for real requests.

- [ ] **Step 4: Run the focused tests and verify they pass**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_hdb_source.py -v`

  Expected: PASS.

- [ ] **Step 5: Commit the HDB adapter**

  ```powershell
  git add -- backend/app/carparks/sources/hdb.py backend/tests/test_hdb_source.py
  git commit -m "refactor: extract HDB carpark source"
  ```

### Task 3: Extract the LTA source adapter

**Files:**
- Create: `backend/app/carparks/sources/lta.py`
- Test: `backend/tests/test_lta_source.py`

**Interfaces:**
- `LtaSource(lookup: Mapping[str, dict], rates: Callable[[str], Mapping[str, str] | None], api_key: str, availability_url: str = LTA_AVAILABILITY_URL, transport: httpx.AsyncBaseTransport | None = None)` implements `CarparkSource`.
- `LtaSource.owns_id()` accepts only IDs with the `LTA_` prefix.
- `LtaSource.list_nearby(...)` preserves static geometry filtering, optional live availability, HDB-agency exclusion, rate lookup, and `unknown` fallback behavior.
- `LtaSource.get_by_id(...)` returns static detail data when live availability is unavailable and retains live timestamps/counts when present.

- [ ] **Step 1: Write failing adapter tests**

  Cover no API key, successful live data with multiple lot entries, failed/invalid live data fallback, HDB-agency exclusion, unknown IDs, and detail lookup for `LTA_19`. Assert that static results remain available and availability is `unknown` when appropriate.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_lta_source.py -v`

  Expected: FAIL because `LtaSource` is not implemented.

- [ ] **Step 3: Implement `LtaSource`**

  Move LTA-specific static lookup, upstream parsing, optional API-key behavior, rate enrichment, and detail resolution. Keep source errors/logging scoped to LTA and avoid FastAPI imports.

- [ ] **Step 4: Run the focused tests and verify they pass**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_lta_source.py -v`

  Expected: PASS.

- [ ] **Step 5: Commit the LTA adapter**

  ```powershell
  git add -- backend/app/carparks/sources/lta.py backend/tests/test_lta_source.py
  git commit -m "refactor: extract LTA carpark source"
  ```

### Task 4: Extract the supplemental source adapter and preserve slash IDs

**Files:**
- Create: `backend/app/carparks/sources/supplemental.py`
- Test: `backend/tests/test_supplemental_source.py`

**Interfaces:**
- `SupplementalSource(lookup: Mapping[str, dict], id_lookup: Mapping[str, str], rates: Callable[[str], Mapping[str, str] | None], lta_development_names: Collection[str])` implements `CarparkSource`.
- `SupplementalSource.owns_id()` accepts only IDs with the `SUPP_` prefix.
- `SupplementalSource.list_nearby(...)` preserves duplicate suppression against LTA development names, rate enrichment, static-only availability, and distance calculation.
- `SupplementalSource.get_by_id(...)` resolves `SUPP_KEPPEL_BAY_TOWER_/_HARBOURFRONT_TOWER_ONE` exactly as emitted by the nearby endpoint.

- [ ] **Step 1: Write failing adapter tests**

  Assert the nearby result contains the exact slash-containing ID, the detail lookup returns the matching name and rates, duplicate LTA-covered names are suppressed, and unknown supplemental IDs produce `CarparkNotFoundError`.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_supplemental_source.py -v`

  Expected: FAIL because `SupplementalSource` is not implemented.

- [ ] **Step 3: Implement `SupplementalSource`**

  Move supplemental lookup, ID generation/lookup, rate enrichment, and static detail behavior. Do not sanitize or rename existing IDs; slash preservation is required for compatibility.

- [ ] **Step 4: Run the focused tests and verify they pass**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_supplemental_source.py -v`

  Expected: PASS.

- [ ] **Step 5: Commit the supplemental adapter**

  ```powershell
  git add -- backend/app/carparks/sources/supplemental.py backend/tests/test_supplemental_source.py
  git commit -m "refactor: extract supplemental carpark source"
  ```

### Task 5: Add the multi-source service

**Files:**
- Create: `backend/app/carparks/service.py`
- Test: `backend/tests/test_carpark_service.py`

**Interfaces:**
- `CarparkService(sources: Sequence[CarparkSource])` stores an explicit source registry in HDB-first order.
- `async nearby(lat: float, lng: float, radius: int) -> list[CarparkAvailability]` gathers all sources, deduplicates by ID with first-source priority, and sorts by distance.
- `async all() -> list[CarparkAvailability]` calls `nearby(1.3521, 103.8198, 100_000)` and sorts by ID as before.
- `async area(north: float, south: float, east: float, west: float) -> list[CarparkAvailability]` validates bounds, computes the enclosing radius, calls `nearby`, and returns only in-rectangle results.
- `async get_by_id(carpark_id: str, lat: float | None, lng: float | None) -> CarparkAvailability` dispatches to the first adapter whose `owns_id()` matches and raises `CarparkNotFoundError` when no source resolves it.
- `build_default_service() -> CarparkService` wires the existing lookup tables, rate function, environment LTA key, and source adapters.

- [ ] **Step 1: Write failing service tests**

  Use small fake adapters implementing the protocol to assert HDB-first deduplication, distance ordering, all-carpark center/radius behavior, area filtering, source dispatch by ID prefix, and not-found behavior.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_carpark_service.py -v`

  Expected: FAIL because `CarparkService` is not implemented.

- [ ] **Step 3: Implement `CarparkService` and `build_default_service()`**

  Keep cross-source coordination here only. Preserve existing source order, sorting, radius constants, and area bounds semantics; do not move source parsing back into the service.

- [ ] **Step 4: Run the focused tests and verify they pass**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_carpark_service.py -v`

  Expected: PASS.

- [ ] **Step 5: Commit the service**

  ```powershell
  git add -- backend/app/carparks/service.py backend/tests/test_carpark_service.py
  git commit -m "refactor: add carpark aggregation service"
  ```

### Task 6: Thin the API layer and add the staging route regression

**Files:**
- Modify: `backend/app/api/carparks.py`
- Modify: `backend/tests/test_map_performance.py`
- Create: `backend/tests/test_carpark_api.py`

**Interfaces:**
- Keep `router` and all four endpoint paths unchanged.
- Instantiate one module-level `service = build_default_service()` and have routes call `service.all()`, `service.nearby(...)`, `service.area(...)`, and `service.get_by_id(...)`.
- Define the detail route as `@router.get("/carparks/{carpark_id:path}", response_model=CarparkAvailability)` so the public path can contain `/`; keep it after `/all`, `/nearby`, and `/area`.
- Translate `CarparkSourceError` and `CarparkNotFoundError` into the existing HTTP status/detail responses at this boundary.
- Keep query validation and response models in the API module; remove source-specific constants, imports, helpers, and fetch/detail implementations from it.

- [ ] **Step 1: Write failing API tests**

  Add a `TestClient` test for the exact slash-containing detail URL with a service stub that returns a supplemental record, asserting HTTP `200` and the unchanged response JSON. Update area tests to patch `carparks_api.service.nearby` rather than deleted module-level source functions. Add a test that invalid bounds return `422` without calling the service.

- [ ] **Step 2: Run the focused tests and verify the route regression fails**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_carpark_api.py backend/tests/test_map_performance.py -v`

  Expected: the new slash-ID test fails against the current `{carpark_id}` route or the service wiring is missing.

- [ ] **Step 3: Replace the API implementation with thin service-backed routes**

  Preserve endpoint paths, response models, query validation, and error details. Use the path converter for detail IDs and keep the catch-all frontend route from handling valid API detail requests.

- [ ] **Step 4: Run the focused API tests and verify they pass**

  Run: `$env:PYTHONPATH='backend'; python -m unittest backend/tests/test_carpark_api.py backend/tests/test_map_performance.py -v`

  Expected: PASS, including the slash-containing supplemental detail case.

- [ ] **Step 5: Commit the API refactor and regression coverage**

  ```powershell
  git add -- backend/app/api/carparks.py backend/tests/test_map_performance.py backend/tests/test_carpark_api.py
  git commit -m "fix: route slash-containing carpark IDs"
  ```

### Task 7: Run the full verification suite

**Files:**
- No new files; verify all files from Tasks 1–6.

- [ ] **Step 1: Run the complete backend suite**

  Run: `$env:PYTHONPATH='backend'; python -m unittest discover -s backend/tests -p "test*.py"`

  Expected: all existing and new backend tests pass with zero failures.

- [ ] **Step 2: Run frontend tests to verify the unchanged contract consumer**

  Run from `frontend`: `npm test`

  Expected: all frontend tests pass; no frontend source-specific changes are required.

- [ ] **Step 3: Review the diff and whitespace**

  Run: `git diff --check` and inspect that `backend/app/api/carparks.py` contains only routing, validation, service calls, and error translation.

- [ ] **Step 4: Confirm the final verification state**

  Expected: `git diff --check` is clean, all backend and frontend tests pass, and no generated artifacts or unrelated files are included in the refactor diff.
