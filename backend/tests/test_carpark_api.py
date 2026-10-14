import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api import carparks
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
            carparks,
            "_get_supplemental_carpark",
            return_value=example_carpark(SLASH_ID),
        ) as lookup:
            response = self.client.get(f"/api/v1/carparks/{SLASH_ID}{self.query}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], SLASH_ID)
        lookup.assert_called_once_with(SLASH_ID, 1.264293167839738, 103.8223046936493)

    def test_encoded_slash_detail_id_is_preserved(self):
        encoded_id = SLASH_ID.replace("/", "%2F")
        with patch.object(
            carparks,
            "_get_supplemental_carpark",
            return_value=example_carpark(SLASH_ID),
        ) as lookup:
            response = self.client.get(f"/api/v1/carparks/{encoded_id}{self.query}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], SLASH_ID)
        lookup.assert_called_once_with(SLASH_ID, 1.264293167839738, 103.8223046936493)

    def test_encoded_slash_detail_id_works_with_public_base_path(self):
        encoded_id = SLASH_ID.replace("/", "%2F")
        with patch.object(main, "app_base_path", "/parkcastsit"):
            with patch.object(
                carparks,
                "_get_supplemental_carpark",
                return_value=example_carpark(SLASH_ID),
            ) as lookup:
                response = self.client.get(
                    f"/parkcastsit/api/v1/carparks/{encoded_id}{self.query}"
                )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], SLASH_ID)
        lookup.assert_called_once_with(SLASH_ID, 1.264293167839738, 103.8223046936493)


if __name__ == "__main__":
    unittest.main()
