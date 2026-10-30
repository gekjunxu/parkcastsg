import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx

from app.carparks.errors import CarparkNotFoundError
from app.carparks.service import build_default_service
from app.carparks.sources.ura import UraSource
from app.data.lta_carpark_lookup import LTA_CARPARK_LOOKUP
from app.data.ura_carpark_lookup import URA_CARPARK_LOOKUP
from src.data_pipeline.fetch_ura_carparks import (
    _load_geojson,
    build_ura_rows,
    write_rows,
)


LOOKUP = {
    "X0001": {
        "name": "Example URA Carpark",
        "lat": 1.3000,
        "lng": 103.8000,
        "total_lots": 42,
    },
}


class UraSourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_static_records_keep_capacity_but_do_not_fake_availability(self):
        source = UraSource(LOOKUP)

        result = (await source.list_nearby(1.3, 103.8, 100))[0]

        self.assertEqual(result.id, "URA_X0001")
        self.assertEqual(result.name, "Example URA Carpark")
        self.assertEqual(result.available_lots, 0)
        self.assertEqual(result.total_lots, 42)
        self.assertEqual(result.crowd_level, "unknown")
        self.assertIsNone(result.availability_timestamp)
        self.assertIsNone(result.weekdays_rate_1)

    async def test_get_by_id_and_ownership(self):
        source = UraSource(LOOKUP)

        result = await source.get_by_id("URA_X0001", None, None)

        self.assertEqual(result.id, "URA_X0001")
        self.assertEqual(source.id_prefix, "URA_")
        with self.assertRaises(CarparkNotFoundError):
            await source.get_by_id("URA_MISSING", None, None)

    async def test_live_car_availability_uses_daily_token_and_car_lots(self):
        requests = []

        async def handler(request):
            requests.append(request)
            if request.url.path == "/token":
                return httpx.Response(200, json={"Status": "Success", "Result": "daily-token"})
            return httpx.Response(
                200,
                json={
                    "Status": "Success",
                    "Result": [
                        {"carparkNo": "X0001", "lotType": "C", "lotsAvailable": "17"},
                        {"carparkNo": "X0001", "lotType": "C", "lotsAvailable": "2"},
                        {"carparkNo": "X0001", "lotType": "M", "lotsAvailable": "99"},
                        {"carparkNo": "OTHER", "lotType": "C", "lotsAvailable": "100"},
                    ],
                },
            )

        source = UraSource(
            LOOKUP,
            api_key="ura-key",
            availability_url="https://ura.test/availability",
            token_url="https://ura.test/token",
            transport=httpx.MockTransport(handler),
        )

        result = (await source.list_nearby(1.3, 103.8, 100))[0]
        detail = await source.get_by_id("URA_X0001", None, None)

        self.assertEqual(result.available_lots, 19)
        self.assertEqual(result.total_lots, 42)
        self.assertEqual(result.crowd_level, "medium")
        self.assertEqual(result.lot_types[0].lot_type, "C")
        self.assertEqual(result.lot_types[0].available_lots, 19)
        self.assertEqual(result.lot_types[0].total_lots, 42)
        self.assertIsNotNone(result.availability_timestamp)
        self.assertEqual(detail.available_lots, 19)

        token_requests = [request for request in requests if request.url.path == "/token"]
        availability_requests = [request for request in requests if request.url.path == "/availability"]
        self.assertEqual(len(token_requests), 1)
        self.assertEqual(token_requests[0].headers["AccessKey"], "ura-key")
        self.assertEqual(len(availability_requests), 2)
        self.assertEqual(availability_requests[0].headers["Token"], "daily-token")
        self.assertEqual(
            availability_requests[0].url.params["service"],
            "Car_Park_Availability",
        )

    async def test_live_failure_falls_back_to_static_capacity(self):
        async def handler(request):
            if request.url.path == "/token":
                return httpx.Response(200, json={"Status": "Success", "Result": "daily-token"})
            return httpx.Response(503, text="unavailable")

        source = UraSource(
            LOOKUP,
            api_key="ura-key",
            availability_url="https://ura.test/availability",
            token_url="https://ura.test/token",
            transport=httpx.MockTransport(handler),
        )

        with self.assertLogs(level="WARNING"):
            result = (await source.list_nearby(1.3, 103.8, 100))[0]

        self.assertEqual(result.available_lots, 0)
        self.assertEqual(result.total_lots, 42)
        self.assertEqual(result.crowd_level, "unknown")
        self.assertIsNone(result.availability_timestamp)


class UraCatalogTests(unittest.TestCase):
    def test_default_service_registers_ura_before_supplemental(self):
        self.assertEqual(
            [source.source_name for source in build_default_service().sources],
            ["hdb", "lta", "ura", "supplemental"],
        )

    def test_catalog_has_car_capacity_and_excludes_lta_codes(self):
        self.assertGreaterEqual(len(URA_CARPARK_LOOKUP), 500)
        self.assertTrue(all(info["total_lots"] > 0 for info in URA_CARPARK_LOOKUP.values()))
        self.assertTrue(set(URA_CARPARK_LOOKUP).isdisjoint(LTA_CARPARK_LOOKUP))

    def test_build_rows_filters_non_car_and_existing_codes(self):
        features = [
            {
                "geometry": {"type": "Point", "coordinates": [103.8, 1.3]},
                "properties": {"PP_CODE": "A0001", "PARKING_PL": "First", "NO_CAR": 4},
            },
            {
                "geometry": {"type": "Point", "coordinates": [103.81, 1.31]},
                "properties": {"PP_CODE": "A0002", "PARKING_PL": "Motorcycles", "NO_CAR": 0},
            },
            {
                "geometry": {"type": "Point", "coordinates": [103.82, 1.32]},
                "properties": {"PP_CODE": "A0003", "PARKING_PL": "Already LTA", "NO_CAR": 8},
            },
        ]

        self.assertEqual(
            build_ura_rows(features, {"A0003"}),
            [
                {
                    "pp_code": "A0001",
                    "name": "First",
                    "lat": 1.3,
                    "lng": 103.8,
                    "total_lots": 4,
                }
            ],
        )

    def test_build_rows_skips_malformed_features_and_keeps_first_duplicate(self):
        features = [
            None,
            {"properties": {}, "geometry": {}},
            {
                "geometry": {"type": "Point", "coordinates": ["bad", 1.3]},
                "properties": {"PP_CODE": "BAD", "PARKING_PL": "Bad", "NO_CAR": 3},
            },
            {
                "geometry": {"type": "Point", "coordinates": [103.8, 1.3]},
                "properties": {"PP_CODE": "a0001", "PARKING_PL": "First", "NO_CAR": 4},
            },
            {
                "geometry": {"type": "Point", "coordinates": [103.81, 1.31]},
                "properties": {"PP_CODE": "A0001", "PARKING_PL": "Duplicate", "NO_CAR": 9},
            },
        ]

        self.assertEqual(build_ura_rows(features, set()), [{
            "pp_code": "A0001",
            "name": "First",
            "lat": 1.3,
            "lng": 103.8,
            "total_lots": 4,
        }])

    def test_geojson_loader_and_writer_use_a_reviewable_csv_shape(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "input.json"
            output = root / "nested" / "ura.csv"
            source.write_text(json.dumps({"features": []}), encoding="utf-8")

            self.assertEqual(_load_geojson(source), {"features": []})
            write_rows([{
                "pp_code": "A0001",
                "name": "First",
                "lat": 1.3,
                "lng": 103.8,
                "total_lots": 4,
            }], output)

            self.assertIn("pp_code,name,lat,lng,total_lots", output.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
