# Typed URA rate schedules

Date: 2026-10-30  
Status: Approved and implemented

## Context

The API currently exposes four nullable text fields:

- `weekdays_rate_1`
- `weekdays_rate_2`
- `saturday_rate`
- `sunday_ph_rate`

LTA and supplemental records populate those fields from the static
`CarparkRates.csv` lookup. The URA adapter currently provides location,
capacity, and optional live availability, but no rates.

The frontend already treats the four fields as schedules when their text
contains windows such as `7am-5pm: $1.20 per hr` or `Aft 5pm: $2 per entry`.
It joins the two weekday fields, resolves `Same as wkdays`/`Same as Saturday`,
filters named days, and chooses the active time window. The parser supports
hourly, per-entry, per-minute, half-hour, and free-parking forms, but it is
still a text parser; it does not retain URA's structured start/end times,
vehicle category, or minimum duration.

URA's official `Car_Park_Details` service provides those structured rows and
is updated daily. The rates must remain runtime data so a failed or stale URA
response never overwrites the reviewed static rates used by other sources.

## Decision

Use option 2: add a typed `rate_schedules` list while retaining the four
legacy text fields as a compatibility projection.

The official URA API remains the source for URA rates:

<https://eservice.ura.gov.sg/maps/api/>

### Backend model

Add an optional, backwards-compatible `rate_schedules` list to the API model.
Each item preserves one URA rate row:

```text
vehicle_type: string
start_time: string
end_time: string
weekday_rate: string | null
weekday_min: string | null
saturday_rate: string | null
saturday_min: string | null
sunday_ph_rate: string | null
sunday_ph_min: string | null
remarks: string | null
```

The vehicle type remains the upstream value (`C`, `M`, `H`, etc.) rather than
being collapsed into the current car-only UI. This keeps the data lossless
for future vehicle-specific pricing without changing today's display.

### URA adapter and caching

`UraSource` will fetch `Car_Park_Details` with the existing daily URA token.
The complete details response is cached in memory for the current Singapore
calendar date. Availability continues to be fetched per request. When the
details request fails, the adapter returns no runtime rate data for that
request and keeps the static catalogue/capacity intact; it does not reuse a
previous day's rates.

Only rows whose `ppCode` is in the existing URA catalogue are attached to a
record. The adapter keeps all vehicle categories in `rate_schedules`, but
only `vehCat == C` is projected into the legacy car-rate fields used by the
current UI.

### Legacy projection

For compatibility with existing API consumers and the current pricing engine,
URA car rows will be rendered into the four text fields:

- all weekday windows go into the weekday schedule text;
- Saturday and Sunday/public-holiday windows go into their existing fields;
- multiple windows are separated without dropping any rows;
- a zero rate with a zero minimum duration is rendered as `Free parking`;
- positive minimum durations are rendered as `per N mins` (with 60 minutes
  rendered as `per hr`).

The projection is generated from the same typed rows and is not written to
`CarparkRates.csv`. Existing LTA/supplemental static rates remain unchanged.

### Frontend behavior

Add the typed schedule to the frontend API and `Carpark` types, while keeping
the existing text pricing path as the compatibility path. URA records will
therefore immediately use the current time-window display, sorting, and
breakdown UI through the projection. The parser will gain only the generic
`per N mins` form needed by URA; existing schedule and alias behavior remains
unchanged.

No new rate UI is required in this slice. The typed list is the lossless API
boundary for future source adapters and vehicle-specific UI, while the current
four-field contract prevents a broad pricing-engine rewrite and reduces
regression risk.

## Failure and freshness rules

- Missing `URA_API_KEY`: return the static URA record with no rate data.
- Token/details HTTP or JSON failure: log a warning, return the static record,
  and do not mutate the static CSV or reuse a prior day's rate cache.
- A malformed details row is skipped; valid rows for the same carpark remain.
- URA rates are daily schedule data, not live occupancy data; the existing
  availability timestamp continues to describe availability only.

## Verification

Add focused tests for:

1. typed model serialization and empty schedule defaults;
2. URA details parsing, vehicle-category retention, car-rate projection, and
   daily cache reuse;
3. details failure fallback without stale rates;
4. generic `per N mins` parsing and URA-style time windows;
5. existing LTA/supplemental rate lookup and frontend pricing regressions.

## Non-goals

- Do not refresh or rewrite `CarparkRates.csv`.
- Do not infer private mall, campus, or operator rates from URA when URA has no
  record for them.
- Do not add a second rate service or a persistent rate database.
- Do not remove the four legacy fields in this change.
