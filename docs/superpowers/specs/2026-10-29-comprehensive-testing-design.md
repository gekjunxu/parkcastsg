# Comprehensive testing design

## Intent

Increase confidence in the carpark source adapters, API boundaries, frontend
behaviour, and the deployed user journey. The recent URA regression showed that
adapter unit tests alone can pass while the real detail route is wrong.

## Goals

- Keep the adapter-routing refactor and its real FastAPI route regression test.
- Expand backend tests around source dispatch, API errors, data-pipeline
  validation, and static catalogue invariants.
- Expand frontend tests around API URL/error handling, raw-to-view-model
  transformation, filtering, pricing, and important component interactions.
- Add browser E2E coverage for a deterministic home → results → detail journey.
- Add coverage measurement and CI thresholds without adding live government API
  calls to tests.
- Commit the resulting verified changes locally; do not deploy or push unless
  separately requested.

## Non-goals

- 100% line coverage.
- Tests that depend on HDB, LTA, URA, OneMap, weather, or Tailscale services.
- Load testing, visual regression snapshots, or mobile-device matrices.
- Reorganising the existing source/test folders purely for aesthetics.

## Approaches

1. Existing unit/integration tools only: fast and small, but would not exercise
   the browser journey or expose coverage gaps reliably.
2. Browser E2E only: validates the UI flow, but misses backend adapter details
   and gives weak diagnosis when a test fails.
3. Layered coverage (chosen): keep focused unit tests, add FastAPI route-level
   E2E, add browser E2E with intercepted deterministic API fixtures, and enforce
   measured coverage in CI. Each layer tests a different boundary and remains
   fast enough for every push.

## Design

### Backend and API

- Keep `backend/tests/test_carpark_e2e.py` as the real-app smoke test for URA
  detail routing.
- Add table-driven routing tests for prefixed sources, the unprefixed HDB
  fallback, duplicate prefixes, and invalid source registration.
- Add API tests for success/error responses and public base-path handling using
  `fastapi.testclient.TestClient`.
- Add pure pipeline tests for malformed GeoJSON, zero/motorcycle-only capacity,
  duplicate codes, existing LTA codes, and generated CSV invariants.
- Use existing `httpx.MockTransport` patterns for upstream adapter failures and
  fallbacks; never call live public APIs from CI.

### Frontend

- Extend the existing Node test runner and Vitest component tests rather than
  introducing another unit-test framework.
- Cover API request construction, non-2xx errors, abort signals, transform
  defaults, URA unknown availability/rates, filter combinations, and navigation
  URLs.
- Add focused component tests for result loading/error states, filter actions,
  carpark detail navigation, and source-specific rate/availability display.

### Coverage

- Add development-only Python coverage tooling and a frontend Vitest V8
  coverage reporter; keep both out of the production container.
- Measure application code only, excluding generated assets, test files, and
  data-only CSV modules where line coverage is not meaningful.
- Establish a practical initial threshold from the measured baseline, with a
  floor for statements, branches, functions, and lines. CI must fail when a
  future change drops below it; thresholds can be raised after the first green
  run.

### Browser E2E

- Add Playwright with Chromium only and a `test:e2e` script/configuration.
- Start the Vite development server locally for the browser test.
- Intercept `/api/v1/locations/suggest`, `/api/v1/carparks/nearby`,
  `/api/v1/carparks/{id}`, and weather calls with deterministic fixture
  responses. Backend route behaviour is covered separately by FastAPI E2E.
- Cover: load home page, search/select a destination, see a result, open its
  detail view, and verify the URA capacity-only state is rendered without a
  fabricated rate or availability.
- CI installs Chromium, runs the smoke test, and uploads a trace only on
  failure.

### CI and commit

- Add separate coverage and browser-E2E steps to `.github/workflows/ci.yml`.
- Keep the existing backend, frontend, build, audit, and container checks.
- Run the full local suite plus coverage, browser E2E, typecheck, build, and
  `git diff --check` before committing.
- Commit the current adapter-routing refactor, API E2E test, coverage tooling,
  expanded tests, and CI changes together as one test-hardening commit.

## Acceptance criteria

- All existing and new backend tests pass with coverage above the recorded
  threshold.
- Frontend unit/component tests, typecheck, build, and coverage pass.
- Playwright’s deterministic browser journey passes locally and in CI.
- No test requires credentials or an external government/Tailscale service.
- The commit is present locally, with no uncommitted test or configuration
  changes remaining.
