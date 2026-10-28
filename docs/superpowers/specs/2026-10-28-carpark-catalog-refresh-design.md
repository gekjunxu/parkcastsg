# Carpark catalogue refresh design

## Intent

Fix the reported missing Pasir Ris Mall result, reduce stale HDB coverage, and
add the official URA capacity catalogue as a separate runtime source.

## Goals

- Refresh the bundled HDB metadata from the current data.gov.sg dataset.
- Keep the duplicated pipeline and runtime HDB snapshots in sync.
- Add Pasir Ris Mall as a rate-only supplemental carpark using its official
  parking tariff and OneMap coordinates.
- Add new car-capable URA parking places keyed by `PP_CODE`, excluding the
  exact codes already present in the LTA static lookup.
- Add a focused regression check for the new rate and location.
- Preserve the existing commercial-rate snapshot and make its review status
  explicit instead of replacing it with an unverified bulk refresh.

## Non-goals and risks

- Do not integrate live URA availability yet. The API requires a separate URA
  access key and daily token; the static catalogue must remain useful without
  either credential.
- Do not redesign the source model or automate private-mall rate collection.
- There is no single authoritative bulk feed for every private mall: the LTA
  parking page says its rates are only a guide and may change without notice,
  while URA access requires credentials. Existing commercial rates therefore
  remain a snapshot; only explicitly source-checked rows are changed.

## Approaches

1. The official URA capacity export provides a broad static source without
   runtime credentials; exact `PP_CODE` overlap is safe to remove.
2. A third-party map source could discover more private carparks but is not a
   reliable authority for rates or live availability.
3. The selected approach is a static HDB refresh, static URA capacity source,
   and curated supplemental entry. It reuses the existing source boundaries
   and keeps rates separate.

## Implementation shape

- Replace both `HDBCarparkInformation.csv` copies with the current public HDB
  export and regenerate both `hdb_clean_coords.csv` copies.
- Copy the existing rate CSV to a temporary backup before editing it.
- Add the official Pasir Ris Mall tariff to `backend/app/data/CarparkRates.csv`
  without rewriting unrelated rows.
- Add the OneMap point for `7 Pasir Ris Central` to
  `backend/app/data/supplemental_carparks.csv`; the existing loader will expose
  it through the existing `SUPP_` path.
- Add `fetch_ura_carparks.py`, `ura_carparks.csv`, and the `URA_` source adapter;
  the generated file stores only positive car capacity and excludes LTA codes.
- Record the rate source and review date in the pipeline documentation so a
  future refresh does not silently treat the whole snapshot as current.
- Extend the existing rate/location test only as needed to prove the new row
  is discoverable and has the expected tariff.

## Verification

- Compare row counts and IDs between the refreshed HDB files.
- Run the backend test suite and the rate-coverage audit.
- Query the supplemental lookup for Pasir Ris Mall and verify its coordinates
  and rate fields.
- Confirm the pre-change rate backup is byte-identical to the original file.
