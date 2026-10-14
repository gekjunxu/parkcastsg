from __future__ import annotations


class LocationServiceError(Exception):
    """Safe error that the API layer can translate into an HTTP response."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
