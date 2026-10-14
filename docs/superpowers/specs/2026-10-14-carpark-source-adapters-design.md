# Carpark Source Adapters Design

## Context

The backend currently concentrates HDB, LTA, and supplemental carpark logic in `backend/app/api/carparks.py`. That module combines HTTP routing, source-specific upstream requests, static lookup behavior, caching, normalization, detail lookup, radius filtering, and cross-source deduplication. This makes a source-specific failure—such as the slash-containing supplemental ID failure in staging—hard to isolate and test.

## Goal

Separate each carpark data source behind a focused backend adapter while preserving the existing public API response shape and frontend behavior. Source failures and source-specific rules should be visible at the source boundary, and common aggregation behavior should live in one service layer.

## Scope and constraints

- Backend-only refactor; the frontend continues to consume the existing `NearbyCarpark` shape and `source` field.
- Preserve the existing endpoints, query parameters, response fields, and source labels (`hdb`, `lta`, `supplemental`).
- Preserve current graceful-degradation behavior: LTA may return static locations without live availability; supplemental locations have unknown availability; HDB upstream failures remain API errors.
- Do not add third-party dependencies.
- Include regression coverage for supplemental IDs containing `/` and ensure the detail route can resolve them through the public path.
- Keep the current working tree's unrelated changes out of this refactor.

## Proposed architecture

### Domain models

Move shared response models and source-neutral types into a focused carpark module. The existing `CarparkAvailability` response model remains the contract returned by the API. A source adapter may use internal records, but the service owns conversion into the response model so API output stays stable.

### Source adapters

Create one adapter per source with a small, explicit interface:

- `HdbSource`: fetches live HDB availability, resolves HDB details, and applies HDB static metadata.
- `LtaSource`: loads LTA static locations/rates, fetches optional live LTA availability, resolves LTA details, and owns the static fallback behavior.
- `SupplementalSource`: loads geocoded supplemental locations and rates, emits unknown availability, and resolves supplemental details including IDs containing punctuation or slashes.

Each adapter owns its upstream URL, cache, source-specific parsing, source-specific error policy, and static lookup dependencies. It must not know about FastAPI request objects or other sources.

### Aggregation service

Create a source-neutral service that receives the registered adapters and provides:

- fetch all or nearby carparks from every source;
- merge results with deterministic source priority and ID deduplication;
- resolve one carpark by ID through the appropriate source;
- apply common distance/radius behavior and preserve response ordering.

The service is the only layer that coordinates multiple sources. Source registration should be explicit so adding another source does not require editing each endpoint branch.

### API layer

Reduce `backend/app/api/carparks.py` to route definitions, query validation, service calls, and HTTP error translation. The detail route must accept a slash-containing ID through a path converter or an equivalent route-safe lookup mechanism, while retaining the existing public URL format.

## Error handling

- Source adapters raise typed or clearly scoped source errors for failures they cannot degrade gracefully.
- The service preserves the current policy: HDB failures fail the request; LTA availability failures degrade to static/empty live data; supplemental data is static-only.
- The API layer translates source/service errors into the existing HTTP status categories and response format.
- Errors should identify the source and operation in logs without leaking API credentials.

## Testing strategy

- Unit-test each adapter independently using local/static fixtures and narrowly scoped upstream response stubs only where network calls are unavoidable.
- Unit-test the aggregation service for merge order, deduplication, radius filtering, and source selection.
- Add an API regression test that resolves `SUPP_KEPPEL_BAY_TOWER_/_HARBOURFRONT_TOWER_ONE` through the detail route and returns `200` with the supplemental record.
- Retain and run all existing backend tests, including static LTA fallback and rate coverage tests.
- Verify the frontend contract remains unchanged by asserting the response model fields and source labels.

## Out of scope

- Frontend source-specific modules or UI changes.
- Changing carpark IDs already emitted by the API.
- Replacing the upstream HDB, LTA, or rates data sources.
- Broad renaming or unrelated cleanup outside the carpark backend boundary.

## Acceptance criteria

1. The API endpoints and response JSON remain backward compatible for existing HDB, LTA, and supplemental records.
2. HDB, LTA, and supplemental logic can be read and tested independently.
3. A failure in one source is handled according to that source's policy and does not obscure the others' behavior.
4. The staging slash-containing supplemental detail URL no longer returns the generic 404.
5. All existing backend tests plus the new adapter and routing tests pass.
