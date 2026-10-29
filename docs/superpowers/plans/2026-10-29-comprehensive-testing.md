# Comprehensive testing implementation plan

## Goal

Implement the approved layered test strategy: backend/API coverage, frontend
coverage thresholds, deterministic Playwright browser E2E, CI integration, and
one verified local commit pushed to `staging`.

## Tasks

### 1. Establish the baseline and preserve existing work

- Inspect the current worktree and keep the adapter-routing refactor, API E2E
  test, and design documents in scope.
- Run the existing backend and frontend suites before adding new infrastructure
  so any pre-existing failure is separated from new failures.

### 2. Complete backend/API coverage

- Add service-router tests for prefix dispatch, unprefixed fallback, duplicate
  prefixes, and invalid fallback registration.
- Add real-app API tests for URA detail success, unknown IDs, and source error
  translation without live upstream calls.
- Add data-pipeline tests for malformed features, capacity filtering,
  duplicate/existing codes, and generated rows.
- Add Python coverage as a development-only dependency and a repeatable command
  that measures `backend/app` while excluding tests and generated/data-only
  modules.

### 3. Complete frontend coverage

- Add API tests for URL/query construction, non-2xx errors, abort propagation,
  and raw response transformation including URA unknown rates/availability.
- Add focused component tests for results loading/error/detail navigation and
  source-specific display where the current test harness supports it.
- Add Vitest V8 coverage configuration and a threshold based on the measured
  baseline, with a non-regressing floor.

### 4. Add browser E2E

- Add Playwright and Chromium-only configuration with a local Vite web server.
- Add deterministic route fixtures for location suggestions, nearby carparks,
  detail, and weather.
- Cover home search → results → carpark detail and assert URA capacity-only
  presentation.
- Configure failure traces and a local/CI `test:e2e` command.

### 5. Wire CI and documentation

- Run backend/frontend coverage in CI in addition to existing checks.
- Install and run Playwright in a separate CI job, preserving traces on failure.
- Document local commands and the no-live-network test contract.

### 6. Verify, commit, and push

- Run backend tests, Python coverage, frontend tests, component tests, frontend
  coverage, typecheck, build, Playwright E2E, compile checks, and `git diff
  --check`.
- Inspect the final diff and ensure no credentials or generated browser
  artifacts are staged.
- Commit the complete change with a focused test-hardening message.
- Push the commit to `origin/staging` and report the commit and CI URL.

## Verification commands

```powershell
$env:PYTHONPATH='..'; python -m unittest discover -s tests -v
python -m coverage run --source=app -m unittest discover -s tests -v
python -m coverage report
npm test
npm run test:component
npm run test:coverage
npm run typecheck
npm run build
npm run test:e2e
python -m compileall -q backend/app src/data_pipeline
git diff --check
```

## Commit boundary

The commit includes the existing adapter-routing refactor and API E2E test,
this plan/design documentation, new coverage infrastructure, frontend/backend
tests, Playwright configuration/fixtures, and CI changes. It does not include
live API credentials, browser output, or a production/staging deployment.
