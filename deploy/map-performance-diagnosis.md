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

## Funnel route trace — 2026-09-30

Read-only diagnostics on the Windows client and ProDesk (Tailscale 1.102.3)
confirmed an overseas Funnel path. These observations supersede the uncertainty
about the actual relay route in the earlier section, but do not identify the
cause of every latency spike.

Observed logical path:

```text
Singapore client / ISP
  -> NTT Singapore -> NTT Tokyo
  -> Tokyo Funnel ingress
  -> Tailscale relay transport (DERP tok observed from ProDesk)
  -> ProDesk in Singapore, TLS termination / Serve
  -> 127.0.0.1:18677 (parkcastsit)
```

Traceroute describes the client-to-ingress leg, not the complete encrypted
tunnel or its reverse path. IPv4 hop 7 was 129.250.6.70, whose PTR is
ae-2.r25.sngpsi07.sg.bb.gin.ntt.net (about 5 ms). Hops 8 and 9 were
129.250.2.243 and 129.250.5.49, with PTRs naming Tokyo (72 ms and 114–123 ms).
The destination 103.84.155.217 answered at 117–123 ms. IPv6 reached
2403:2500:400:20::25a at 69–76 ms; its PTR is ingress-tok-01.tailscale.com.
Missing intermediate ICMP responses are not evidence of packet loss.

Public DNS returned two IPv4 and two IPv6 ingress addresses. Requests pinned
to each address with curl --resolve (normal certificate verification retained)
were correlated with before/after Funnel peer byte counters:

| Public ingress | Peer address suffix | Peer relay | Direct endpoint |
| --- | --- | --- | --- |
| 103.84.155.217 | ::5c01:d68c | tok | empty |
| 103.84.155.153 | :6268:d02b | tok | empty |
| 2403:2500:400:20::25a | :6268:d02b | tok | empty |
| 2403:2500:400:20::e8e | ::5c01:d68c | tok | empty |

Both peers are named funnel-ingress-node. Each request increased its matched
peer's transmitted bytes by about 5.9 KB. Three Tailscale pings to each peer
reported `via DERP(tok)` and ended with `direct connection not established`:
453/498/528 ms for the first peer, 270/195/677 ms for the second. Their netmap
entries advertised HomeDERP 7 (Tokyo) and no direct endpoints. Endpoint history
also contained only the DERP route. This establishes relay use during these
tests; it does not prove a local firewall fault or that ingress can be made direct.

ProDesk netcheck independently found UDP, IPv4 and IPv6 working, consistent NAT
mapping, Singapore DERP at 1.7 ms and Tokyo at 75.2 ms. A nearby Singapore DERP
does not imply the public Funnel ingress is in Singapore. None of the Funnel
peers in this particular netmap advertised Singapore as its home relay.

Health endpoint timings, with no upstream parking-data fetch:

| Probe | Total elapsed |
| --- | --- |
| ProDesk loopback HTTP | 2.5 ms |
| ProDesk hostname HTTPS resolving privately to its Tailscale IP | 32 ms |
| ProDesk forced through public IPv4 ingress | 706 ms |
| Windows fresh public connections, initial six samples | 607–1,504 ms |
| Windows later pinned-ingress samples | 609–5,293 ms |
| Windows one fresh IPv6 connection | 1,908 ms |
| Next three requests reusing that same connection | 387 / 407 / 435 ms |

For the 1,908 ms request, TCP completed at 71 ms, TLS completed at 1,416 ms,
and the first response byte arrived at 1,908 ms. Thus about 1,345 ms elapsed
between TCP and TLS completion, and another 492 ms before the first byte.
These phases include network/proxy/relay work; they must not be interpreted
as time spent doing TLS cryptography on ProDesk. The reused requests made zero
new connections and avoided TLS setup, yet retained hundreds of milliseconds
of latency. The Linux public/private comparison also shows that Windows TLS
implementation alone does not explain the overhead.

Conclusion: the Singapore–Tokyo detour and measured DERP transport are confirmed
contributors to the slow public experience. Connection setup amplifies the
delay. The tests do not isolate congestion, retransmission, or ingress queuing
as the cause of the variable multi-second outliers. Existing daemon logs also
contained dropped ingress TCP packets; packet flags/lifetimes were not captured,
so these cannot responsibly be identified as failed live requests.

No network settings, ACLs, DNS records, Funnel mappings, or deployments were
changed. Private Tailscale access is a useful faster path for personal testing;
public performance should be evaluated separately. Changing ProDesk's preferred
DERP alone is not demonstrated to change Funnel ingress selection.

References: [Funnel architecture](https://tailscale.com/docs/features/tailscale-funnel)
and [interpreting DERP diagnostics](https://tailscale.com/docs/reference/troubleshooting/network-configuration/derp-routing).
