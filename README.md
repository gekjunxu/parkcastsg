# ParkCastSG

ParkCastSG helps drivers find nearby Singapore carparks and compare the price
they are likely to pay now. It combines live public availability with a local
rate catalogue and runs without a database or machine-learning service.

## What it does

- Searches Singapore destinations and postal codes with OneMap.
- Shows nearby HDB, LTA DataMall, and supplemental carparks.
- Displays live availability where an upstream source provides it.
- Calculates current HDB pricing and shows published commercial rates.
- Sorts by cheapest, closest, availability, or a balanced recommendation.
- Shows rain conditions, shelter information, favourites, and navigation links.

## Architecture

```text
Browser
  |-- same-origin web app
  `-- /api/v1/*
          |
          `-- FastAPI
                |-- data.gov.sg (HDB availability)
                |-- LTA DataMall (optional live availability)
                |-- data.gov.sg weather forecast
                `-- bundled CSV rate and location catalogues
```

There is no PostgreSQL/RDS dependency and no prediction inference. Static CSV
files load into memory when FastAPI starts. The production container builds the
React app and serves it from FastAPI, so only one process and port are needed.

## Quick start with Docker

1. Copy `.env.example` to `.env`.
2. Add your own LTA DataMall key if you want live LTA availability.
3. Start the app:

```sh
docker compose up --build -d
```

Open `http://localhost:8080`. Health and API documentation are available at
`/health` and `/docs`.

The LTA key is optional. Without it, HDB live availability, static LTA
locations, and the supplemental rate catalogue continue to work; LTA entries
show an explicit unavailable-live-data state until a key is configured.

## Local development

Backend:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend, in another terminal:

```powershell
cd frontend
npm ci
npm run dev
```

The frontend defaults to `http://localhost:8000` during development. Override it
with `VITE_API_BASE_URL` when the API is elsewhere.

## Self-hosting on OpenWrt

The single-container layout is suitable for a small Linux server, NAS, Raspberry
Pi, or container-capable router. Many consumer OpenWrt routers do not ship with
Docker and may not have enough writable storage or RAM for Python containers.

For branch-isolated deployments to the Tailnet host `prodesk`, see
`deploy/README.md`. The GitHub Actions workflow can run `main` and multiple
feature branches concurrently as separate Compose projects.

Before targeting a router, check its exact model and:

```sh
uname -m
free -h
df -h
```

The router must also be able to make outbound HTTPS requests to the Singapore
government APIs. If the Orbi cannot comfortably run containers, run ParkCastSG
on another always-on LAN device and access it through the router. Do not expose
the service directly to the internet without HTTPS and an access-control layer.

## Rate data

The bundled catalogues live in `backend/app/data/`:

- `HDBCarparkInformation.csv`: HDB properties and parking rules.
- `CarparkRates.csv`: commercial and public carpark rate descriptions.
- `lta_carparks.csv`: LTA carpark locations.
- `supplemental_carparks.csv`: rate-only carparks not covered by live sources.

Rate completeness and freshness are more important than prediction accuracy for
this project. See `src/data_pipeline/README.md` for the manual refresh tools.
Never commit an LTA API key or another credential to these files.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Service health |
| `GET` | `/api/v1/carparks/all` | All known carparks |
| `GET` | `/api/v1/carparks/nearby` | Carparks near a latitude/longitude |
| `GET` | `/api/v1/carparks/{id}` | One carpark with current details |
| `GET` | `/api/v1/weather` | Nearest two-hour weather forecast |

## Public release checklist

- Rotate any credential that was previously committed.
- Keep `.env` untracked and use GitHub/container secrets for deployments.
- Review the source and update date of each rate catalogue.
- Run the automated checks before merging.
- Add a licence before accepting outside contributions.
