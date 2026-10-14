# Data maintenance tools

These scripts refresh or generate the static carpark catalogues used by the
FastAPI service. They are maintenance commands, not a scheduled ingestion or
database pipeline.

## Responsibilities

- `fetch_lta_carparks.py`: downloads LTA carpark metadata and writes the static
  LTA lookup CSV.
- `geocode_rates_carparks.py`: geocodes rate-catalogue entries that are not in
  the HDB or LTA datasets.
- `generate_coords.py`: converts HDB SVY21 coordinates to WGS84.
- `fetch_hdb.py` and `fetch_weather.py`: small API inspection helpers.
- `spatial_mapping.py`: maps carparks to their nearest weather forecast area.
- `audit_rate_coverage.py`: reports matched and unmatched LTA rate coverage.

Install the maintenance-only dependencies with:

```sh
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and use your own LTA DataMall key when running an
LTA refresh. Review generated diffs before copying CSV output into
`backend/app/data/`. Rate text should retain its source wording because the
frontend pricing parser supports time bands, per-entry charges, and free periods.

There is currently no automatic updater for `CarparkRates.csv`. Each public
release should record where and when its rate catalogue was obtained.

## Verified rate corrections

The Downtown East and Harbourfront Centre rows were checked against their
official published tariffs on 2026-10-13. Downtown East uses the operator's
2026 chart: <https://www.downtowneast.com.sg/services/carpark-charges>.
Harbourfront Centre uses LTA's current parking-rate listing:
<https://onemotoring.lta.gov.sg/content/onemotoring/home/owning/ongoing-car-costs/parking/parking_rates.4.html>.
The IKEA Alexandra and IKEA Tampines rows were checked against IKEA's current
store pages on the same date:
<https://www.ikea.com/sg/en/stores/alexandra/> and
<https://www.ikea.com/sg/en/stores/tampines/>. The IKEA Alexandra map point was
corrected to the Alexandra store using its official address and a geotagged
2025 photo:
<https://commons.wikimedia.org/wiki/File:Ikea_Alexandra_Singapore_(2025)_-_img_02.jpg>.
These checks apply to these four records only; the rest of the catalogue still
needs periodic source-by-source review.

Downtown East's pricing details also note that school holidays follow the
Fri–Sun tariff. School-holiday dates are not modeled by the app, so it cannot
automatically switch to that tariff on those dates. The operator's 9pm–5am
free-parking offer applies only to Begonia Open Air Carpark.

Run the coverage audit after changing rate or LTA data:

```sh
python src/data_pipeline/audit_rate_coverage.py
```
