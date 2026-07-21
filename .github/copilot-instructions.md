# ParkCastSG development notes

ParkCastSG is a lightweight Singapore carpark finder. Its priority is accurate,
comprehensive current pricing, followed by live availability and distance.

- The FastAPI service has no database and no ML/prediction runtime.
- Static lookup CSVs load into memory at process startup.
- HDB and LTA availability are fetched from their upstream APIs.
- The LTA key must come from `LTA_API_KEY`; never commit a real key.
- Keep unknown availability and unknown amenities distinct from zero/false.
- Frontend API access belongs in `frontend/src/api/`.
- Backend API routes belong under `/api/v1`.
- Production serves the Vite build and API from one FastAPI origin.
- Add or update tests when changing rate parsing, source matching, or API shapes.
