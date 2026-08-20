from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
import os

# Load .env once here, before any module reads env vars
load_dotenv()

from app.api import carparks, weather

cors_allow_origins_env = os.getenv("CORS_ALLOW_ORIGINS")
if cors_allow_origins_env:
    allowed_origins = [
        origin.strip()
        for origin in cors_allow_origins_env.split(",")
        if origin.strip()
    ]
else:
    allowed_origins = ["http://localhost:5173"]

app = FastAPI(title="ParkCast SG API")

app_base_path = os.getenv("APP_BASE_PATH", "/").strip()
if app_base_path and app_base_path != "/":
    app_base_path = "/" + app_base_path.strip("/")
else:
    app_base_path = ""


@app.middleware("http")
async def strip_app_base_path(request, call_next):
    """Accept requests both with and without the public proxy path prefix."""
    if app_base_path:
        request_path = request.scope["path"]
        if request_path == app_base_path or request_path.startswith(app_base_path + "/"):
            stripped_path = request_path[len(app_base_path):] or "/"
            request.scope["path"] = stripped_path
            request.scope["raw_path"] = stripped_path.encode("utf-8")
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {"status": "healthy"}


app.include_router(carparks.router, prefix="/api/v1")
app.include_router(weather.router, prefix="/api/v1")


# A production image can place the compiled frontend in /app/static and serve
# the entire application from one origin. Local development still uses Vite.
static_dir = Path(
    os.getenv(
        "STATIC_DIR",
        str(Path(__file__).resolve().parents[1] / "static"),
    )
)

if static_dir.is_dir():
    assets_dir = static_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        """Serve static files and fall back to index.html for SPA routes."""
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found")

        static_root = static_dir.resolve()
        requested_file = (static_root / full_path).resolve()
        if (
            full_path
            and requested_file.is_relative_to(static_root)
            and requested_file.is_file()
        ):
            return FileResponse(requested_file)

        index_file = static_root / "index.html"
        if not index_file.is_file():
            raise HTTPException(status_code=404, detail="Frontend is not built")
        return FileResponse(index_file)
