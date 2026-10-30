# Typed URA Rate Schedules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add daily URA parking-rate schedules to the API and current pricing UI without changing the reviewed static rate catalogue or breaking existing text-rate behavior.

**Architecture:** Parse URA `Car_Park_Details` rows into a typed backend schedule model, cache that response only for the current Singapore date, and project car rows back into the existing four text fields for compatibility. Keep the frontend's current window parser as the display/sorting path, adding only the generic `per N mins` unit needed by URA projections.

**Tech Stack:** FastAPI/Pydantic, Python `unittest`, TypeScript, Node test runner, existing frontend pricing utilities.

**Spec:** `docs/superpowers/specs/2026-10-30-typed-ura-rate-schedules-design.md`

## Global Constraints

- Do not modify or regenerate `backend/app/data/CarparkRates.csv`.
- URA details are runtime data cached only for the current Singapore calendar date.
- A failed URA details request must not reuse a previous day's rates or mutate static catalogue data.
- Preserve the four legacy rate fields and existing LTA/supplemental lookup behavior.
- Retain every valid URA vehicle category in `rate_schedules`; project only `vehCat == C` into the legacy car-rate fields.
- Do not add a dependency or a persistent rate database.

## Review Focus

- Zero-rate/zero-duration URA rows must become free parking, not an unusable `$0.00` tariff — covered by the URA projection test in Task 1.
- Multiple URA windows for one day must remain ordered and all be present in the legacy projection — covered by the projection test in Task 1 and adapter test in Task 2.
- Motorcycle/heavy rows must remain in typed data but must not alter car sorting/display — covered by the typed parsing and adapter tests in Tasks 1–2.
- Missing API keys, malformed rows, and details HTTP/JSON failures must preserve static capacity and return no runtime rates — covered by Task 2.
- Existing text schedules and per-entry semantics must not regress while adding `per N mins` — covered by Task 3 and the existing pricing suite.

---

### Task 1: Add the typed schedule model and pure URA rate conversion

**Files:**
- Create: `backend/app/carparks/ura_rates.py`
- Modify: `backend/app/carparks/models.py`
- Test: `backend/tests/test_ura_rates.py`
- Test: `backend/tests/test_carpark_foundation.py`

**Interfaces:**
- Produces `CarparkRateSchedule` in `backend/app/carparks/models.py` with fields `vehicle_type`, `start_time`, `end_time`, `weekday_rate`, `weekday_min`, `saturday_rate`, `saturday_min`, `sunday_ph_rate`, `sunday_ph_min`, and `remarks`; rate/minimum/remarks fields are nullable strings.
- Produces `parse_ura_rate_schedules(entries: list[Mapping[str, Any]]) -> dict[str, list[CarparkRateSchedule]]` in `backend/app/carparks/ura_rates.py`.
- Produces `project_ura_car_rates(schedules: Sequence[CarparkRateSchedule]) -> dict[str, str | None]` returning exactly the four legacy keys `weekdays_rate_1`, `weekdays_rate_2`, `saturday_rate`, and `sunday_ph_rate`.

- [x] **Step 1: Write the failing model and conversion tests**

  Add tests that assert:

  - a valid URA car row and a valid motorcycle row are retained under the same `ppCode`;
  - a row without a usable `ppCode` is skipped;
  - a `$0.00`/`0 mins` segment projects to `Free parking`;
  - a `30 mins` segment projects to `per 30 mins`, and a `60 mins` segment to `per hr`;
  - multiple windows stay in source order and all appear in the projected weekday/Saturday/Sunday strings;
  - `CarparkAvailability(...).rate_schedules` defaults to an empty list.

- [x] **Step 2: Run the focused backend tests and verify they fail**

  Run from `backend`:

  ```text
  python -m unittest tests.test_ura_rates tests.test_carpark_foundation -v
  ```

  Expected: failure because the typed model, parser, and projection are not implemented.

- [x] **Step 3: Implement the model and pure conversion helpers**

  Add `rate_schedules: list[CarparkRateSchedule] = []` to `CarparkAvailability`. In `ura_rates.py`, preserve upstream strings, skip malformed rows, group by uppercase `ppCode`, format positive minimum durations as `per N mins`/`per hr`, and format zero rate plus zero duration as `Free parking`. Do not perform HTTP or caching in this module.

- [x] **Step 4: Run the focused backend tests and verify they pass**

  ```text
  python -m unittest tests.test_ura_rates tests.test_carpark_foundation -v
  ```

- [x] **Step 5: Commit the self-contained model/conversion change**

  ```text
  git add backend/app/carparks/models.py backend/app/carparks/ura_rates.py backend/tests/test_ura_rates.py backend/tests/test_carpark_foundation.py
  git commit -m "feat: model and project URA rate schedules"
  ```

### Task 2: Fetch, cache, and attach URA daily details

**Files:**
- Modify: `backend/app/carparks/sources/ura.py`
- Modify: `backend/tests/test_ura_source.py`
- Modify: `backend/tests/test_carpark_e2e.py`

**Interfaces:**
- Consumes `parse_ura_rate_schedules(...)` and `project_ura_car_rates(...)` from Task 1.
- `UraSource` continues to expose the existing `list_nearby(...)` and `get_by_id(...)` methods; their returned `CarparkAvailability` objects now include typed schedules and projected car rates when URA details are available.
- The existing URA invoke URL is used with `service=Car_Park_Details`; no new external endpoint configuration is required.

- [x] **Step 1: Write the failing adapter tests**

  Extend the mock transport tests to return a `Car_Park_Details` response containing:

  - two car windows for `X0001`, including `$0.60`/`30 mins`;
  - one motorcycle row for `X0001`;
  - an unrelated carpark row.

  Assert that `list_nearby` and `get_by_id` retain the typed vehicle rows, project only car rows into the legacy fields, send the `Car_Park_Details` service parameter and required headers, and make one details request for two calls on the same Singapore date. Add failure tests for a 503/invalid details response and for an unconfigured key; assert static capacity remains and `rate_schedules`/legacy rates are empty.

- [x] **Step 2: Run the focused adapter tests and verify they fail**

  ```text
  python -m unittest tests.test_ura_source tests.test_carpark_e2e -v
  ```

  Expected: failure because the adapter currently does not call `Car_Park_Details` or attach rates.

- [x] **Step 3: Implement daily details fetching and safe attachment**

  Add an in-memory details cache keyed by the current Singapore date. Reuse `_get_token`, request `service=Car_Park_Details` with the same browser-compatible headers, normalize the response through Task 1, and pass the schedule map into `_record`. On a details failure, log the warning and pass no rate data for that response; do not fall back to a prior date's cache. Keep availability request frequency and timestamps unchanged.

- [x] **Step 4: Run the focused adapter and route tests and verify they pass**

  ```text
  python -m unittest tests.test_ura_source tests.test_carpark_e2e -v
  ```

- [x] **Step 5: Commit the URA adapter change**

  ```text
  git add backend/app/carparks/sources/ura.py backend/tests/test_ura_source.py backend/tests/test_carpark_e2e.py
  git commit -m "feat: attach daily URA parking rates"
  ```

### Task 3: Preserve the frontend contract and parse URA minute units

**Files:**
- Modify: `frontend/src/api/carparkService.ts`
- Modify: `frontend/src/app/data/carparks.ts`
- Modify: `frontend/src/app/utils/pricingEngine.ts`
- Modify: `frontend/src/api/carparkService.test.ts`
- Modify: `frontend/src/app/utils/pricingEngine.test.ts`

**Interfaces:**
- `NearbyCarpark` accepts optional backend `rate_schedules` rows using the snake_case API names.
- `Carpark` stores the transformed `rateSchedules` list using camelCase names.
- `transformCarpark(...)` maps the list without changing the existing four legacy rate mappings.
- `parseTextRate(...)` additionally converts `$X per N mins` to an hourly comparison using `X * 60 / N`, while retaining existing per-entry and unknown-unit behavior.

- [x] **Step 1: Write the failing frontend tests**

  Add a transform assertion for a URA schedule row and parser assertions that:

  - `$0.32 per 15 mins` becomes `{ amount: 1.28, basis: 'hour' }`;
  - `07.00 AM-08.30 AM: $0.60 per 30 mins` selects the active window and becomes `{ amount: 1.2, basis: 'hour' }`;
  - existing per-entry and alias tests continue to pass.

- [x] **Step 2: Run the focused frontend tests and verify they fail**

  ```text
  npm run test:node -- --test-name-pattern="URA|mins|window|alias"
  ```

  Expected: the new typed-field assertion and generic minute-unit assertion fail before implementation.

- [x] **Step 3: Implement the type mapping and generic minute parser**

  Add the optional raw schedule shape, transform it to the existing frontend naming convention, and place the numeric-minute branch alongside the current half-hour/per-minute branches without changing the ordering of existing matches.

- [x] **Step 4: Run the frontend tests and static checks**

  ```text
  npm run test:node
  npm run typecheck
  ```

- [x] **Step 5: Commit the frontend compatibility change**

  ```text
  git add frontend/src/api/carparkService.ts frontend/src/app/data/carparks.ts frontend/src/app/utils/pricingEngine.ts frontend/src/api/carparkService.test.ts frontend/src/app/utils/pricingEngine.test.ts
  git commit -m "feat: expose URA rate schedules to pricing"
  ```

### Task 4: Full verification and handoff

**Files:**
- No production files expected; only fix test/typing issues discovered by the complete suite.

**Interfaces:**
- Consumes the API contract and tests from Tasks 1–3.
- Produces a verified branch with no static-rate catalogue changes.

- [x] **Step 1: Run the complete backend test suite**

  From `backend`:

  ```text
  python -m coverage run --branch --source=app -m unittest discover -s tests -v
  ```

  Expected: all backend tests pass.

- [x] **Step 2: Run the complete frontend checks**

  From `frontend`:

  ```text
  npm run typecheck
  npm run test:coverage
  npm run build
  ```

  Expected: all tests pass, configured coverage thresholds pass, and the production build succeeds.

- [x] **Step 3: Inspect the final diff for stale-rate safety**

  Verify `backend/app/data/CarparkRates.csv` is unchanged, URA details are not persisted, and failures do not return previous-day schedules.

- [x] **Step 4: Commit any final verification fixes**

  ```text
  git add <only the files changed by this feature>
  git commit -m "test: verify URA rate schedule integration"
  ```

- [x] **Step 5: Report verification evidence and deployment readiness**

  Include the commit hashes, test commands/results, and the fact that URA rates are daily schedule data while availability remains the live, separately timestamped feed.
