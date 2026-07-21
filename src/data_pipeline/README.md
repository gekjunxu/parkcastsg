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
