# OneMap Autocomplete Design

**Status:** Revised after design review; implementation pending

**Date:** 2026-10-14

## Goal

Add maintainable Singapore address and place autocomplete to ParkCast without exposing OneMap credentials to the browser or coupling the frontend directly to OneMap's authentication lifecycle.

## Scope

The first implementation will add a server-side OneMap search adapter, a small ParkCast suggestions endpoint, and one reusable destination autocomplete component used by both the home-page search and the results/map search. Selecting a suggestion will use the coordinates returned by OneMap, so the app does not perform a second geocoding request. Text-only result URLs will retain first-result geocoding through the backend.

Availability data, carpark-source adapters, map tiles, and the existing result-page cache are outside this change.

## Architecture

```text
Browser search form
        |
        | GET /api/v1/locations/suggest?q=...
        v
ParkCast location API
        |
        v
OneMap client -- in-memory access-token cache --> OneMap auth/search APIs
```

The browser talks only to ParkCast. The backend reads OneMap credentials from process environment variables, obtains an access token when needed, and sends the token in the upstream `Authorization` header.

## Backend contract

### Configuration

The backend reads:

- `ONEMAP_API_EMAIL`
- `ONEMAP_API_PASSWORD`

Both values are optional at process startup. The endpoint reports a configuration error only when a request needs OneMap and the values are missing. Neither value may be logged or returned in an error response.

### Token lifecycle

The OneMap client owns token acquisition and refresh. It must:

1. Keep the access token and expiry timestamp in process memory only.
2. Treat a token as refreshable five minutes before its advertised expiry.
3. Reuse a valid cached token across searches.
4. Share one in-flight authentication task between concurrent callers. A caller cancelling its search must not cancel a refresh needed by other callers.
5. When a search rejects a token, compare that rejected token with the current cached token. Invalidate only if they match; a delayed rejection of an older token must reuse the newer token instead of discarding it.
6. Retry a search once after an explicit invalid/expired-token response, whether signalled by HTTP 401 or a documented JSON authentication error. General search errors and malformed responses must not trigger authentication retries. A second token rejection ends with `502`.
7. Share authentication failures across callers and suppress new authentication attempts for 30 seconds after a failure. During that cooldown return `502`. Do not serve an expired or rejected token. If refresh fails within the five-minute safety window, also return `502` rather than silently falling back to that token.
8. Validate authentication responses: token must be nonempty and expiry must be a finite future UNIX timestamp beyond the five-minute refresh window. Invalid responses produce `502` and enter the same cooldown.
9. Avoid logging credentials, access tokens, or full authenticated request URLs.

OneMap tokens normally last three days. ParkCast automatically re-requests a token by POSTing the stored server-side credentials to `https://www.onemap.gov.sg/api/auth/post/getToken` when a search arrives within five minutes of `expiry_timestamp` or after expiry. Use the returned timestamp rather than assuming a fixed 72-hour timer. An idle application needs no scheduled renewal; its next search renews the token before contacting the search API. This continues across successive three-day lifetimes without user intervention.

Each worker owns its token cache and refresh task. Cross-worker coordination is deferred. Use the existing `httpx` dependency with explicit five-second connection and ten-second read/write/pool timeouts; each auth/search request also has a 15-second total deadline. Close owned HTTP clients on application shutdown. Inject transport and clock dependencies for deterministic tests.

The token is not persisted to the repository, filesystem, browser storage, or a database. A process restart simply authenticates again on the next search.

### Suggestions endpoint

`GET /api/v1/locations/suggest?q=<query>`

Query rules:

- Trim surrounding whitespace before forwarding.
- Accept 2–100 characters after trimming.
- Return an empty list for a valid query with no OneMap results.

Response shape:

```json
[
  {
    "label": "KEPPEL BAY TOWER",
    "address": "...",
    "postal": "098585",
    "lat": 1.264293,
    "lng": 103.822305
  }
]
```

`label` is the OneMap display value, preferring a nonempty `SEARCHVAL` and falling back to `ADDRESS`. `address` and `postal` may be null when OneMap omits them. Discard records without a nonempty label or finite coordinates within latitude -90..90 and longitude -180..180. The endpoint returns at most eight normalized suggestions in OneMap order. A missing/non-list `results` field or malformed upstream JSON is an upstream failure, not an empty result.

Error semantics:

- Missing backend credentials: `503` with a generic configuration detail.
- OneMap authentication or search failure: `502` with a generic upstream detail.
- Valid query with no matching records: `200 []`.
- Invalid query length after trimming: `422`, without calling OneMap.

Backend logs for failures include `source=onemap`, the operation (`authenticate` or `search`), and a safe error category/status. Do not log raw user queries, upstream bodies, passwords, or tokens.

## Frontend behavior

The current direct browser call to OneMap will be removed. Frontend API code will expose:

- `suggestLocations(query: string, signal?: AbortSignal): Promise<LocationSuggestion[]>`, returning the normalized suggestions defined above.
- `geocodeQuery(query: string, signal?: AbortSignal): Promise<Coordinates | null>`, returning the first suggestion's coordinates or null for an empty result. The results-page load flow passes its existing abort signal into this helper.

Both helpers use `API_BASE` from `frontend/src/app/runtime.ts`. The deployed staging URL must be `/parkcastsit/api/v1/locations/suggest`, and local development must retain its existing API-base configuration. Build navigation with `URLSearchParams` so labels containing `/`, `&`, or Unicode round-trip correctly.

Autocomplete behavior:

- Start after two characters.
- Debounce requests by 250 milliseconds; only request while the input is focused and its trimmed length is 2–100 characters.
- Abort the previous request on query change, dismissal, or unmount. Also guard responses with a request generation so a late response cannot replace newer suggestions.
- Clear suggestions immediately when the query changes or falls below the length threshold.
- Show up to eight suggestions in a listbox attached to an accessible combobox with `aria-expanded`, `aria-controls`, and `aria-activedescendant`.
- Arrow Down/Up moves the active option; no option is active initially. Enter selects an active option and prevents the parent form from submitting a second search. With no active option, Enter submits the text query. Escape closes the list; Tab leaves the input without automatically selecting an option.
- Pointer selection must complete before blur dismisses the list. Blur/outside click closes it, and late responses must not reopen it. Suppress Enter selection/submission while an IME composition is active.
- Selecting a suggestion fills the search field and navigates to `/results?q=...&lat=...&lng=...&radius=...`.
- Preserve Enter-to-search behavior for users who do not select a suggestion.
- Treat autocomplete failure as non-blocking; the user can still submit the text query and see the existing error state if it cannot be resolved.

## Secrets and deployment

GitHub Actions will read `ONEMAP_API_EMAIL` and `ONEMAP_API_PASSWORD` from the staging environment secrets. It writes a protected temporary runtime configuration file and transfers it to the remote deployment's untracked `.env`. Serialize credential values safely for Compose dotenv parsing, including `$`, quotes, `#`, and backslashes; preserve the exact values without expansion. `compose.yaml` must explicitly forward both variables into the backend container environment. The workflow will not place them in the source archive, frontend build variables, logs, or committed files. Runtime credentials are readable by administrators of the deployment host.

The staging environment must be configured with:

```text
ONEMAP_API_EMAIL=<the registered OneMap email>
ONEMAP_API_PASSWORD=<the OneMap password>
```

These values should be added through GitHub repository/environment secret settings, never pasted into source control or chat. Production secrets are not required for this staging-only change.

## Testing requirements

Backend tests must cover:

- Token reuse before the five-minute safety window.
- Automatic renewal across two successive three-day lifetimes, at the five-minute boundary, after idle expiry, and after a restart with no cached token.
- Concurrent callers sharing one refresh request and one failure/cooldown; cancellation of one caller does not cancel shared refresh.
- Delayed rejection of an old token preserves its replacement; only one search retry occurs.
- Malformed auth responses, missing expiry, timeouts, and exhausted retries produce controlled failures.
- OneMap JSON token errors and invalid/expired search tokens.
- Successful normalization, invalid-coordinate filtering, result limiting, and empty results.
- Missing credentials returning `503` and upstream failures returning `502`.
- Query trimming and the 2–100 character validation boundary.

Frontend tests must cover the staging-prefixed API URL, first-result geocoding, cancellation, and encoded coordinate navigation. Component tests must exercise the 250ms debounce, stale-response suppression, Enter precedence, arrow keys, Escape, blur/pointer selection, IME composition, and unmount cleanup. Verify the shared component is wired into both search entry points. The existing frontend test suite must continue to pass. Add only the development test dependencies needed for these interaction tests.

Deployment verification must prove both OneMap variables are forwarded into the container and round-trip representative synthetic credential values without printing real credentials. Browser smoke checks must cover home and results/map searches under `/parkcastsit`.

## Non-goals and deferred decisions

- No availability-result cache is introduced.
- No persistent token store, Redis dependency, or cross-process cache is introduced.
- No OpenStreetMap/POI import is introduced.
- No OneMap account credential rotation automation is introduced.
- OneMap remains an implementation detail behind the ParkCast endpoint so it can later be replaced or supplemented without changing the search form contract.

## Acceptance criteria

1. A browser request to the ParkCast suggestions endpoint never requires OneMap credentials in frontend code.
2. Repeated searches reuse a process-local token and refresh safely without a request stampede.
   Renewal continues automatically over successive three-day token lifetimes, including after an idle period longer than three days.
3. A OneMap outage produces a controlled API error and does not leak secrets.
4. Selecting a suggestion opens the existing results page centered on the selected coordinates.
5. Existing carpark list/detail behavior and source-priority rules remain unchanged.
6. Staging deployment can be configured solely by adding the two GitHub staging secrets.
