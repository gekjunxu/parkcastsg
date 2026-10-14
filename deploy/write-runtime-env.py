from __future__ import annotations

import argparse
import os
from collections.abc import Mapping
from pathlib import Path


RUNTIME_VARIABLES = (
    "LTA_API_KEY",
    "CORS_ALLOW_ORIGINS",
    "ONEMAP_API_EMAIL",
    "ONEMAP_API_PASSWORD",
)


def quote_dotenv_value(value: str) -> str:
    """Quote one-line values for Docker Compose dotenv parsing."""
    if "\x00" in value or "\r" in value or "\n" in value:
        raise ValueError("runtime environment values must be single-line strings")
    return "'" + value.replace("'", "\\'") + "'"


def write_runtime_env(
    path: str | os.PathLike[str],
    *,
    port: str,
    app_base_path: str,
    vite_base_path: str,
    environment: Mapping[str, str] | None = None,
) -> None:
    source = os.environ if environment is None else environment
    values = {
        "PARKCAST_PORT": port,
        "ENVIRONMENT": "production",
        "APP_BASE_PATH": app_base_path,
        "VITE_BASE_PATH": vite_base_path,
        **{name: source.get(name, "") for name in RUNTIME_VARIABLES},
    }
    content = "".join(f"{name}={quote_dotenv_value(value)}\n" for name, value in values.items())

    destination = Path(path)
    temporary = destination.with_name(f".{destination.name}.{os.getpid()}.tmp")
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
        temporary.chmod(0o600)
        temporary.replace(destination)
        destination.chmod(0o600)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def main() -> None:
    parser = argparse.ArgumentParser(description="Write the private ParkCast runtime dotenv file")
    parser.add_argument("path", type=Path)
    parser.add_argument("--port", required=True)
    parser.add_argument("--app-base-path", required=True)
    parser.add_argument("--vite-base-path", required=True)
    args = parser.parse_args()
    write_runtime_env(
        args.path,
        port=args.port,
        app_base_path=args.app_base_path,
        vite_base_path=args.vite_base_path,
    )


if __name__ == "__main__":
    main()
