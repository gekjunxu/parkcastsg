# Mobile map redesign (staging)

Both `/results` and `/map` now use the same results/map implementation. `/map`
remains a compatible entry point for existing links. The `staging` branch deploys
only to `/parkcastsit`; do not merge into `main` until the staging trial is accepted.

## Design references

- [Material bottom sheets](https://m2.material.io/components/sheets-bottom/web):
  show contextual information while retaining an interactive map. Mobile uses a
  compact, non-modal results panel with explicit List/Map buttons and a swipe handle.
- [NN/g mobile maps](https://www.nngroup.com/articles/mobile-maps-locations/):
  avoid competing page-scroll/map-pan gestures and small, crowded touch targets.
  The map occupies the remaining viewport; the expanded list scrolls independently.
- [Apple Maps nearby exploration](https://support.apple.com/en-gb/guide/iphone/iphbaf51b2c0/ios):
  let people explore another area by moving the map. Nearby results offer Search
  this area, then the list follows the visible map bounds.
- [Leaflet clustering](https://leaflet.github.io/Leaflet.markercluster/):
  batch marker insertion, cluster dense points, and remove distant markers from
  the DOM. Cluster counts explicitly say carparks; individual pins show lots or P
  for availability that is not tracked.

## Performance and behavior

- Nearby searches call only the nearby endpoint. The full dataset is fetched only
  on entry to exploration, cached for 60 seconds, and explicitly refreshable.
- A local development run with the staging API loaded 2,377 markers into the
  cluster layer in 44ms; 70 nearby markers took 4ms. These are desktop-browser
  measurements with a mobile viewport, not guarantees for phone hardware or network
  latency. The initial upstream API response can still take several seconds.
- Only 30 list cards render initially, with explicit pagination. Panning uses local
  bounds filtering and does not re-fetch or rebuild the island-wide marker layer.
- Search and refresh responses cannot overwrite newer requests. Weather loads
  independently. Filters do not reset the viewport; explicit searches can recenter.
- Prices, unknown availability, rain filtering, location accuracy, details and
  navigation chooser behavior remain available. Detail/back retains map context.

## Validation

- `npm test`: pricing regression tests plus bounds, distance and immutable filtering.
- `npm run build` and `npm audit --omit=dev --audit-level=high`.
- Browser checks: 390px mobile, 320px small phone, desktop; search, radius, filters,
  list/map switch, cluster zoom, pin selection, details/back and area exploration.
- The optional full TypeScript check still reports existing issues in
  `carparkService.ts` (nullable recommendation) and the unused `ui/calendar.tsx`
  (old day-picker icon props). The changed map files introduce no type errors.

Before this trial, the production backup served `assets/index-BWEN-ha3.js`.
Verify that asset remains unchanged after the staging deployment.
