# URA live availability design

## Intent

Use the existing URA capacity catalogue as the stable location/capacity
fallback, while enriching it with live car-lot availability when the optional
`URA_API_KEY` is present in the deployment environment.

## Approach

The URA adapter will request one daily token from URA, cache it in process
memory, and call `Car_Park_Availability` for the live feed. `C` entries are
aggregated by PP code and merged into the existing static records. Missing
keys, token failures, malformed responses, and upstream HTTP failures retain
the current static-capacity/unknown-availability behaviour.

## Scope

- Add `URA_API_KEY` to Compose, the GitHub deployment workflow, runtime-env
  generation, and deployment documentation.
- Keep the key server-side; never expose it to the frontend or logs.
- Test token caching, car-lot filtering/aggregation, and safe fallback with
  `httpx.MockTransport`.
- Do not replace the static URA catalogue or add live rate fetching in this
  change.
