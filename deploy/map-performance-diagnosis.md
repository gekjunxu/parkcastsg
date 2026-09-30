# Map performance diagnosis — 2026-09-30

## Root cause and scope

The mobile redesign routed **Search this area** to `/map`, which fetched
`/api/v1/carparks/all`. A small-area interaction therefore downloaded 2,377
carparks and constructed the full marker set. This was a frontend regression.
The 44ms figure in the initial mobile notes measured only marker construction,
not download, decode, pricing transformation or time until the map was usable.

The fix keeps area searches on `/results` and requests `/carparks/area` with the
visible rectangle. The backend returns only that rectangle, using an enclosing
nearby query to cover its corners. Bounds wider than 0.12 degrees per axis prompt
zooming in instead of falling back to an island-wide request. Superseded nearby
and area requests are aborted. Explicit **Explore all Singapore carparks** still
has its intentional island-wide behavior, matching the old explorer.

Application-level GZip middleware compresses JSON and static assets when clients
support it. No Funnel, DNS, Tailnet, Docker or deployment configuration is changed.

## Before: old production versus original redesign

Three fresh HTTP connections per sample group; curl with `--compressed` from this
Windows client. Counts/bytes fluctuate slightly as availability changes. Neither
old nor new origin compressed the responses before this fix.

| Request | Old `/parkcast` median | Original `/parkcastsit` median | Wire bytes |
|---|---:|---:|---:|
| Health | 0.535s | 0.566s | 20 |
| Bugis nearby, 1km | 0.880s | 0.867s | 42,785 |
| Whole island | 2.694s | 2.696s | 1,463,536 |

The underlying APIs performed similarly. The regression was choosing the much
larger request: about 34 times the nearby payload. Whole-island transfers ranged
from 1.51 to 3.65 seconds on staging, before any browser processing.

Direct loopback requests on ProDesk isolated the backend: warm nearby responses
were approximately 0.07–0.10s; whole-island responses 0.10–0.12s; health 1–2ms.
There were occasional roughly 1.2s upstream cold responses. Container CPU was
about 0.15%, and staging memory about 61MiB. There was no evidence of server load.

## Tailscale interpretation

The public path adds observable latency relative to loopback, including DNS,
TCP/TLS setup and relay transport. Fresh public health connections took roughly
0.55s. This overhead affects both deployments and does not explain the new
area-search regression.

Read-only ProDesk `tailscale netcheck` reported UDP available, working IPv4/IPv6,
consistent NAT mapping, and Singapore as the nearest DERP at 2.7ms. This does not
identify the actual Funnel relay path or prove that every connection is direct.
It does not establish a DERP fault. No connectivity settings were changed.

[Tailscale's Funnel documentation](https://tailscale.com/docs/features/tailscale-funnel)
explains that public traffic uses Funnel relays and is subject to non-configurable
bandwidth limits. These measurements do not establish which specific relay hop
accounts for the public-path overhead.

## Validation

- Frontend: 12 tests, including area URL round-trip and oversized-view guards.
- Backend: 7 tests, including rectangle filtering, corner coverage, pre-fetch
  validation, and compressed/uncompressed response equivalence.
- Browser: actual nearby → zoom → Search this area stayed on `/results`; the
  backend log contained `/carparks/area` and no `/all` request. The tested viewport
  returned 42 carparks; marker preparation took about 3ms on this desktop browser.
- Production backup remains outside the deployment scope.

Post-deployment transfer measurements are recorded in the task report.
