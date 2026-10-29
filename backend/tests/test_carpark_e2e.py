import unittest

from fastapi.testclient import TestClient

from app.data.ura_carpark_lookup import URA_CARPARK_LOOKUP
from app.main import app


class CarparkEndToEndTests(unittest.TestCase):
    def test_ura_detail_uses_the_real_app_route_and_source(self):
        code, info = next(iter(URA_CARPARK_LOOKUP.items()))

        with TestClient(app) as client:
            response = client.get(f"/api/v1/carparks/URA_{code}")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["id"], f"URA_{code}")
        self.assertEqual(body["source"], "ura")
        self.assertEqual(body["total_lots"], info["total_lots"])
        self.assertEqual(body["crowd_level"], "unknown")
        self.assertIsNone(body["availability_timestamp"])

    def test_unknown_ura_detail_returns_not_found(self):
        with TestClient(app) as client:
            response = client.get("/api/v1/carparks/URA_DOES_NOT_EXIST")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "URA carpark 'URA_DOES_NOT_EXIST' not found")


if __name__ == "__main__":
    unittest.main()
