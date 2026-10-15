# OneMap Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide autocomplete on both ParkCast search fields with automatic OneMap token renewal and server-side credentials.

**Architecture:** A focused backend OneMap client owns authentication, token lifetime, upstream search, and normalization. A thin locations route exposes its normalized response. A shared frontend component consumes the existing deployment-aware API convention.

**Tech Stack:** FastAPI, existing httpx, Python unittest; React/TypeScript, existing Node test runner plus component-test development dependencies as needed; GitHub Actions and Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-14-onemap-autocomplete.md`

## Global Constraints

- Implement from the isolated staging worktree; target staging deployment `/parkcastsit`.
- Credentials: `ONEMAP_API_EMAIL` and `ONEMAP_API_PASSWORD`, server-side only.
- Process-local token cache; refresh five minutes before returned `expiry_timestamp`; 30-second authentication-failure cooldown.
- Normally three-day tokens renew automatically on demand across successive lifetimes; no manual or scheduled renewal is required.
- One shared refresh task per process; one search retry after explicit token rejection.
- Auth/search requests: five-second connect timeout, ten-second read/write/pool timeouts, 15-second total deadline.
- Queries: trim then validate 2–100 characters; maximum eight results in upstream order.
- Frontend: 250ms debounce and existing `API_BASE`; use one component in home and results/map.
- Preserve existing carpark behavior; introduce no availability or search-result cache.

## Review Focus

- Idle for more than three days: first new search reauthenticates before searching.
- Concurrent old-token rejections: a delayed response cannot discard a newly obtained token.
- Aborted search: shared refresh survives cancellation and late suggestions do not reappear.
- Credentials containing dotenv metacharacters: container receives exact original values.
- Enter, pointer, or IME interaction: one intended navigation, with selected coordinates and retained radius.

---

### Task 1: OneMap client and automatic token renewal

**Files:** Create `backend/app/locations/__init__.py`, `backend/app/locations/models.py`, `backend/app/locations/errors.py`, `backend/app/locations/onemap.py`, and `backend/tests/test_onemap_client.py`.

**Interfaces:**

- `LocationSuggestion`: Pydantic model with `label: str`, `address: str | None`, `postal: str | None`, `lat: float`, `lng: float`.
- `LocationServiceError(status_code: int, detail: str)` exposes a safe HTTP status and detail.
- `OneMapClient(email: str | None, password: str | None, *, http: httpx.AsyncClient, clock: Callable[[], float])` receives injected HTTP and time dependencies.
- Produces `async search(query: str) -> list[LocationSuggestion]`; caller supplies trimmed, validated input. HTTP client ownership stays with application lifespan.

- [ ] Write failing async unittest cases using `httpx.MockTransport` and a controllable clock. Assert initial authentication, cached reuse, and renewal at `expiry - 300`, after idle expiry, and across two consecutive 259200-second lifetimes. Assert auth uses stored credentials in JSON and search uses the access token in the Authorization header.
- [ ] Add concurrency cases: a burst causes exactly one auth call; delayed old-token rejection reuses the replacement; auth failures share one call and suppress attempts for 30 seconds; cancelling one waiter does not cancel shared refresh. Assert the second token rejection ends without a third search.
- [ ] Add malformed-token/expiry, network-timeout, JSON-token-error, general-error-without-reauth, empty-results, malformed-results, missing-label, nonfinite/out-of-range coordinates, and eight-result-limit cases. Verify safe errors/logs contain no synthetic password or token.
- [ ] Run `python -m unittest discover -s tests -p test_onemap_client.py -v` in `backend`; confirm failures are due to absent behavior.
- [ ] Implement the interfaces and spec rules. Use one shared refresh task, generation-aware rejection handling, the 30-second cooldown, and explicit request deadlines. Normalize results in this module.
- [ ] Run the same tests; require all to pass. Commit this independently testable client change.

### Task 2: Locations API and application lifecycle

**Files:** Create `backend/app/api/locations.py` and `backend/tests/test_locations_api.py`; modify `backend/app/main.py`.

**Interfaces:**

- Consumes `OneMapClient.search` and `LocationSuggestion` from Task 1.
- Produces `GET /api/v1/locations/suggest?q=... -> list[LocationSuggestion]` and `get_location_client(request: Request) -> OneMapClient` for dependency injection.
- Application lifespan owns/closes its `httpx.AsyncClient` and exposes one OneMap client via application state.

- [ ] Write failing API tests for trimmed length boundaries 1/2/100/101, whitespace-only input, no upstream calls for invalid input, `200 []`, missing credentials `503`, upstream failure `502`, and `/parkcastsit/api/v1/locations/suggest`. Verify routes precede the SPA fallback and client shutdown closes owned resources.
- [ ] Run `python -m unittest discover -s tests -p test_locations_api.py -v` in `backend`; confirm expected failures.
- [ ] Implement query validation after trimming, dependency injection, safe error translation, lifespan ownership, and router registration before the frontend catch-all.
- [ ] Run the API tests and `python -m unittest discover -s tests -v`; require all to pass. Commit the API/lifecycle change.

### Task 3: Shared autocomplete and search integration

**Files:** Modify `frontend/src/api/geocode.ts`, `frontend/src/app/pages/home-page.tsx`, `frontend/src/app/pages/results-page.tsx`, `frontend/package.json`, and its lockfile. Create `frontend/src/app/components/destination-search.tsx`, `frontend/src/app/components/destination-search.test.tsx`, `frontend/src/api/geocode.test.ts`, and `frontend/src/styles/destination-search.css`.

**Interfaces:**

- Consumes the locations API using `API_BASE` from `frontend/src/app/runtime.ts`.
- Produces `suggestLocations(query: string, signal?: AbortSignal): Promise<LocationSuggestion[]>` and `geocodeQuery(query: string, signal?: AbortSignal): Promise<Coordinates | null>`.
- Produces `DestinationSearch({value, onChange, onSelect, onSubmit, inputLabel, placeholder, className?})`, where callbacks are `(value: string) => void`, `(suggestion: LocationSuggestion) => void`, and `() => void`; the other props are strings. It owns debounce, dropdown, cancellation, and keyboard/pointer handling; parent owns radius and navigation.

- [ ] Add only the development test harness needed to render/interact with the component (Vitest, jsdom, and React Testing Library), preserving the existing Node tests. Add a separate component-test script.
- [ ] Write failing API tests for `/parkcastsit` URL generation, query encoding, abort forwarding, empty-first-result geocoding, and upstream error handling.
- [ ] Write failing component tests with fake timers for 250ms debounce, 2–100 limits, request generations, cancellation/unmount, arrow navigation, Enter selection versus text submission, Escape, Tab, blur/pointer selection, and IME composition. Assert each selection emits exactly one callback.
- [ ] Run new targeted tests; confirm expected failures. Implement the shared component and API helpers.
- [ ] Integrate both search entry points. Parent selection uses `URLSearchParams` with `q`, `lat`, `lng`, and the selected radius. Results-page text geocoding passes its load abort signal. Add integration tests asserting selected coordinates, encoded labels, radius, and one navigation from each entry point.
- [ ] Run existing Node tests, component/API tests, and `npm.cmd run build` in `frontend`; require all to pass. Commit the frontend change.

### Task 4: Staging secrets and deployment verification

**Files:** Modify `.github/workflows/deploy-prodesk.yml`, `compose.yaml`, `.env.example`, and `deploy/README.md`. Create `deploy/write-runtime-env.py` and `backend/tests/test_runtime_env.py` if a serializer is needed to preserve dotenv values safely.

**Interfaces:**

- Workflow consumes staging environment secrets `ONEMAP_API_EMAIL` and `ONEMAP_API_PASSWORD`; runtime configuration forwards both through Compose into the backend.
- `write-runtime-env.py` reads the workflow environment and writes the named runtime file without printing credentials. Preserve existing deployment variables and file permissions.

- [ ] Write failing tests using synthetic values containing `$`, quotes, `#`, and backslashes. Assert emitted dotenv values round-trip without expansion and Compose forwards both variables. No real secrets enter tests.
- [ ] Implement secret-to-runtime serialization/transfer and explicit Compose environment entries; update `.env.example` with blank values and deployment instructions with the staging secret names and automatic three-day renewal behavior.
- [ ] Run the serializer/configuration tests and appropriate Compose configuration checks with synthetic credentials; require exact value preservation and no secret output.
- [ ] Run remaining required CI checks, inspect the final diff for credential exposure, and commit deployment configuration/documentation.
- [ ] Verify staging secret names are configured without reading their values. If missing, provide the exact GitHub staging environment setup steps; do not request passwords in chat.
- [ ] Once secrets are configured, push the verified change to staging using the established deployment flow, monitor CI/deployment, and smoke-test home/results searches under `/parkcastsit`. Demonstrate expiry renewal with the deterministic clock tests rather than waiting three days.

## Review and handoff

- [ ] Review the completed branch against the spec, especially refresh races, request cancellation, both search entry points, and credential propagation.
- [ ] Record checks and deployment outcome. Report any configuration-dependent blocker accurately; do not claim successful live OneMap search until observed.
