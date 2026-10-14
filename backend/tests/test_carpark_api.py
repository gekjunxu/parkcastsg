import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.api import carparks
from app.carparks.errors import CarparkSourceError
from app.main import app
import app.main as main


SLASH_ID = "SUPP_KEPPEL_BAY_TOWER_/_HARBOURFRONT_TOWER_ONE"


def example_carpark(carpark_id: str):
    return carparks.CarparkAvailability(
        id=carpark_id,
        name="Keppel Bay Tower / Harbourfront Tower One",
        address="Keppel Bay Tower / Harbourfront Tower One",
        lat=1.264293,
        lng=103.822305,
        available_lots=0,
        total_lots=0,
        lot_types=[],
        crowd_level="unknown",
        is_sheltered=None,
        distance=0,
        night_parking=None,
        car_park_type="CAR PARK",
        source="supplemental",
    )


class SlashContainingCarparkIdTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.query = "?lat=1.264293167839738&lng=103.8223046936493"

    def test_raw_slash_detail_id_is_preserved(self):
        with patch.object(
            carparks.service,
            "get_by_id",
            new=AsyncMock(return_value=example_carpark(SLASH_ID)),
        ) as lookup:
            response = self.client.get(f"/api/v1/carparks/{SLASH_ID}{self.query}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], SLASH_ID)
        lookup.assert_awaited_once_with(SLASH_ID, 1.264293167839738, 103.8223046936493)


class CarparkApiCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.query = "?lat=1.264293167839738&lng=103.8223046936493"

    def test_static_routes_are_registered_before_detail_and_frontend_catchall(self):
        route_names = [getattr(route, "name", None) for route in carparks.router.routes]
        positions = {
            name: route_names.index(name)
            for name in (
                "get_all_carparks",
                "get_nearby_carparks",
                "get_carparks_in_area",
                "get_carpark",
            )
        }
        self.assertLess(positions["get_all_carparks"], positions["get_carpark"])
        self.assertLess(positions["get_nearby_carparks"], positions["get_carpark"])
        self.assertLess(positions["get_carparks_in_area"], positions["get_carpark"])
        app_routes = list(app.routes)
        frontend_index = next(
            (index for index, route in enumerate(app_routes) if getattr(route, "path", None) == "/{full_path:path}"),
            None,
        )
        detail_index = next(
            (index for index, route in enumerate(app_routes) if getattr(route, "endpoint", None) is carparks.get_carpark),
            None,
        )
        if frontend_index is not None and detail_index is not None:
            self.assertLess(detail_index, frontend_index)

    def test_nearby_default_radius_is_preserved(self):
        with patch.object(carparks.service, "nearby", new=AsyncMock(return_value=[])) as nearby:
            response = self.client.get("/api/v1/carparks/nearby?lat=1.3&lng=103.8")

        self.assertEqual(response.status_code, 200)
        nearby.assert_awaited_once_with(1.3, 103.8, 500)

    def test_source_errors_keep_their_http_status_and_detail(self):
        error = CarparkSourceError("hdb", "list_nearby", None, 502, "upstream failed")
        with patch.object(carparks.service, "nearby", new=AsyncMock(side_effect=error)):
            response = self.client.get("/api/v1/carparks/nearby?lat=1.3&lng=103.8")

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], "upstream failed")

    def test_encoded_slash_detail_id_is_preserved(self):
        encoded_id = SLASH_ID.replace("/", "%2F")
        with patch.object(
            carparks.service,
            "get_by_id",
            new=AsyncMock(return_value=example_carpark(SLASH_ID)),
        ) as lookup:
            response = self.client.get(f"/api/v1/carparks/{encoded_id}{self.query}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], SLASH_ID)
        lookup.assert_awaited_once_with(SLASH_ID, 1.264293167839738, 103.8223046936493)

    def test_encoded_slash_detail_id_works_with_public_base_path(self):
        encoded_id = SLASH_ID.replace("/", "%2F")
        with patch.object(main, "app_base_path", "/parkcastsit"):
            with patch.object(
                carparks.service,
                "get_by_id",
                new=AsyncMock(return_value=example_carpark(SLASH_ID)),
            ) as lookup:
                response = self.client.get(
                    f"/parkcastsit/api/v1/carparks/{encoded_id}{self.query}"
                )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], SLASH_ID)
        lookup.assert_awaited_once_with(SLASH_ID, 1.264293167839738, 103.8223046936493)


if __name__ == "__main__":
    unittest.main()
