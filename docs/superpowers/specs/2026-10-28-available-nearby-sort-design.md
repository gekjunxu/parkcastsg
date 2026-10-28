# Available Nearby Sort Design

## Intent

Remove the stale `Recommended` concept. The current flag is a fixed HDB + sheltered + high-availability heuristic, not a learned or user-specific recommendation, so it should not be presented as neutral advice.

## Goals

- Treat HDB, LTA, and supplemental carparks equally in the default ranking.
- Replace the vague `Recommended` sort with the explicit `Available nearby` sort.
- Keep `Most Available` for users who want the largest reported free-lot count.
- Remove the per-card `Recommended` badge and its reason text.
- Keep the existing Cheapest, Closest, and filter behavior unchanged.

## Non-goals

- No ML or prediction service.
- No new pricing, source-preference, or personalization rules.
- No change to backend API payloads.

## Approaches

1. Remove Recommended and make Most Available the default. This is the smallest change, but it makes raw lot count the default and can place a large, distant carpark first.
2. Replace Recommended with Available nearby. This keeps a useful default while exposing the rule: rank high, moderate, low, unknown, and full availability in that order, then use walking time as the tie-breaker. This is the chosen approach because it is transparent and source-neutral.

## Implementation

Remove `isRecommended` from the frontend model and transform, update the sort/filter union and default state to `nearby`, remove recommendation UI from `CarparkCard`, update the README wording, and add a focused sort regression test to the normal frontend test command.

