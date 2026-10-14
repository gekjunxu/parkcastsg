from __future__ import annotations


class CarparkSourceError(Exception):
    def __init__(
        self,
        source_name: str,
        operation: str,
        carpark_id: str | None,
        status_code: int,
        detail: str,
    ) -> None:
        self.source_name = source_name
        self.operation = operation
        self.carpark_id = carpark_id
        self.status_code = status_code
        self.detail = detail
        context = f" source={source_name} operation={operation}"
        if carpark_id is not None:
            context += f" carpark_id={carpark_id}"
        super().__init__(f"{detail} ({context.strip()})")


class CarparkNotFoundError(CarparkSourceError):
    def __init__(
        self,
        source_name: str,
        operation: str,
        carpark_id: str,
        detail: str,
    ) -> None:
        super().__init__(source_name, operation, carpark_id, 404, detail)
