# ParkCastSG frontend

React, TypeScript, Vite, Tailwind CSS, and Leaflet interface for ParkCastSG.

During local development it calls `http://localhost:8000` by default. Set
`VITE_API_BASE_URL` to another API origin when needed. Production leaves the
value empty because the single-container deployment serves the API and frontend
from the same origin.

```sh
npm ci
npm run dev
npm run build
```

The production output is written to `dist/`.
