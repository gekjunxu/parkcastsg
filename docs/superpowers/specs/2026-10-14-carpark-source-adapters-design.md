# Carpark Source Adapters Design

## Context

The staging backend currently concentrates HDB, LTA, and supplemental carpark logic in `backend/app/api/carparks.py`. That module combines HTTP routing, source-specific upstream requests, static lookup behavior, normalization, detail lookup, radius filtering, and cross-source deduplication. A source-specific failure—such as the slash-containing supplemental ID failure—is therefore difficult to isolate and test.

## Goal

Separate each carpark data source behind a focused adapter while preserving the existing API response shape and frontend behavior. Each adapter normalizes its own data directly into the shared `CarparkAvailability` model. A service layer owns only cross-source coordination and common filtering rules.

## Scope and constraints

- Backend-only refactor; the frontend continues to consume the existing `NearbyCarpark` shape and `source` field.
- Preserve the existing endpoints, query parameters, response fields, defaults, source labels, ordering, and carpark IDs.
- Preserve source error policy: missing record → `404`; HDB upstream failure → `502`; LTA upstream failure → static fallback; supplemental data is static-only.
- Do not introduce availability caching in this refactor. The inspected staging module has no availability cache. Any future cache must be separately designed with expiry, concurrency, and stale-data rules.
- Include the slash-route fix as the first independently tested change.
- Keep unrelated working-tree changes out of this refactor.

## Adapter contract

All adapters implement the same source-neutral protocol and return the shared model directly:

```python
class CarparkSource(Protocol):
    source_name: str

    def owns_id(self, carpark_id: str) -> bool: ...

    async def list_nearby(
        self, lat: float, lng: float, radius: int
    ) -> list[CarparkAvailability]: ...

    async def get_by_id(
        self,
        carpark_id: str,
        lat: float | None,
        lng: float | None,
    ) -> CarparkAvailability: ...
```

The contract has no FastAPI types and no knowledge of other sources. Each adapter owns its source URL, parsing, source-specific metadata joins, source-specific logging, and source-specific fallback policy. Adapters may prefilter static candidates before making upstream requests. They must use the shared distance helper rather than implementing separate distance formulas.

The adapters are:

- `HdbSource`: live HDB availability, HDB metadata, lot-type totals, and HDB detail lookup.
- `LtaSource`: static LTA locations/rates, optional live availability, and static fallback when the API key or upstream feed is unavailable. It must filter the static LTA lookup by radius before making the live LTA request.
- `SupplementalSource`: static geocoded locations and rates, unknown availability, and supplemental detail lookup. It returns all in-range supplemental records; it does not import LTA lookup names or suppress another source.

## Shared models, helpers, and errors

Move `CarparkAvailability` and `LotTypeAvailability` into a source-neutral carpark domain module. Move common geometry, crowd-level, rate-field, lot-type, and conservative name-canonicalization helpers there. The existing rates lookup may re-export the canonicalization helper so its current callers remain compatible.

Define source errors explicitly:

- `CarparkSourceError` includes `source_name`, `operation`, optional `carpark_id`, `status_code`, and `detail`.
- `CarparkNotFoundError` is a `CarparkSourceError` with status `404`.
- HDB adapter failures use status `502` and log source, operation, and carpark ID when applicable.
- LTA upstream failures log source and operation, then return static records with `unknown` availability rather than raising.
- Supplemental lookup failures use `404` for missing IDs; it has no upstream failure mode.

The API layer translates these errors to HTTP responses; adapters do not import FastAPI.

## Aggregation service and duplicate ownership

`CarparkService` receives an explicit ordered registry of adapters: HDB, LTA, then supplemental. It owns:

- fetching nearby results from all adapters;
- HDB-first ID deduplication;
- all-carpark center/radius behavior;
- map-area bounds validation, enclosing-radius calculation, and inclusive edge filtering;
- source selection for detail lookup based on `owns_id()`.

Cross-source name suppression also belongs here. For list responses only, the service builds canonical development-name keys from the LTA results and removes supplemental records whose canonical name matches an LTA record. This replaces the current supplemental-to-LTA import coupling. Direct supplemental detail lookup is never suppressed: existing IDs, including `SUPP_KEPPEL_BAY_TOWER_/_HARBOURFRONT_TOWER_ONE`, remain resolvable.

The service does not contain HDB, LTA, or supplemental parsing branches. Its only source-aware rule is the explicitly documented cross-source suppression and HDB-first merge priority.

## API layer and route compatibility

Reduce `backend/app/api/carparks.py` to route definitions, query validation, service calls, and error translation. The detail route must use a path converter:

```python
@router.get("/carparks/{carpark_id:path}", response_model=CarparkAvailability)
```

It remains after the static `/all`, `/nearby`, and `/area` routes so those routes are selected first. The route must accept both raw `/` and encoded `%2F` forms of the slash-containing ID, with and without the `/parkcastsit` application base path. The frontend-visible API response remains unchanged.

## Compatibility tests

The refactor must have concrete tests for:

- raw and encoded slash-containing detail URLs, including `/parkcastsit` path stripping;
- `/all`, `/nearby`, and `/area` being registered before the detail route and before the frontend catch-all;
- `/area` bounds validation, inclusive north/south/east/west edges, and no upstream call for invalid or oversized bounds;
- LTA live availability where `AvailableLots=0` remains distinct from a carpark missing from the live feed;
- existing response defaults, source labels, ordering, HDB-first ID priority, and static LTA fallback;
- source errors with the expected status and logging context.

## Out of scope

- Frontend source-specific modules or UI changes.
- Changing existing carpark IDs or replacing upstream HDB, LTA, or rates data sources.
- New availability caching, retries, stale-data serving, or cache invalidation.
- Broad cleanup outside the carpark backend boundary.

## Acceptance criteria

1. Each source adapter has the explicit protocol above and returns `CarparkAvailability` directly.
2. The service owns cross-source suppression, deduplication, ordering, area filtering, and detail source selection without source parsing branches.
3. LTA static radius prefiltering prevents unnecessary live upstream requests.
4. Existing API JSON and fallback behavior remain compatible.
5. Raw and encoded slash-containing detail URLs work under `/parkcastsit` and without it.
6. All existing backend tests plus the new adapter, service, compatibility, and route tests pass.
