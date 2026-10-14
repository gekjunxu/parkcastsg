import unittest

import httpx

from app.carparks.errors import CarparkSourceError
from app.carparks.sources.hdb import HdbSource


LOOKUP = {
    "A1": {
        "address": "One Example Road",
        "lat": 1.3000,
        "lng": 103.8000,
        "is_sheltered": True,
        "night_parking": False,
        "car_park_type": "MULTI-STOREY CAR PARK",
        "free_parking": "NO",
        "short_term_parking": "WHOLE DAY",
        "is_central": True,
        "is_peak": False,
    }
}


def payload(available: int = 12):
    return {
        "items": [
            {
                "timestamp": "2026-10-14T00:00:00+00:00",
                "carpark_data": [
                    {
                        "carpark_number": "A1",
                        "carpark_info": [
                            {"lot_type": "C", "lots_available": available, "total_lots": 100}
                        ],
                    }
                ],
            }
        ]
    }


class HdbSourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_list_and_detail_normalize_the_upstream_payload(self):
        async def handler(request):
            return httpx.Response(200, json=payload())

        source = HdbSource(LOOKUP, transport=httpx.MockTransport(handler))
        results = await source.list_nearby(1.3, 103.8, 100)
        detail = await source.get_by_id("a1", 1.3, 103.8)

        self.assertEqual(results[0].id, "A1")
        self.assertEqual(results[0].available_lots, 12)
        self.assertEqual(results[0].total_lots, 100)
        self.assertEqual(results[0].crowd_level, "high")
        self.assertEqual(results[0].availability_timestamp, "2026-10-14T00:00:00+00:00")
        self.assertEqual(detail.id, "A1")
        self.assertEqual(detail.distance, 0)

    async def test_unknown_id_is_not_an_upstream_failure(self):
        source = HdbSource(LOOKUP)

        with self.assertRaises(CarparkSourceError) as raised:
            await source.get_by_id("missing", None, None)

        self.assertEqual(raised.exception.status_code, 404)

    async def test_upstream_failure_is_a_502_and_logs_context(self):
        async def handler(request):
            return httpx.Response(503, text="unavailable")

        source = HdbSource(LOOKUP, transport=httpx.MockTransport(handler))
        with self.assertLogs(level="ERROR") as logs:
            with self.assertRaises(CarparkSourceError) as raised:
                await source.get_by_id("A1", None, None)

        self.assertEqual(raised.exception.status_code, 502)
        self.assertIn("source=hdb", "\n".join(logs.output))
        self.assertIn("operation=get_by_id", "\n".join(logs.output))
        self.assertIn("carpark_id=A1", "\n".join(logs.output))

    async def test_invalid_json_is_a_502(self):
        async def handler(request):
            return httpx.Response(200, text="not-json")

        source = HdbSource(LOOKUP, transport=httpx.MockTransport(handler))
        with self.assertRaises(CarparkSourceError) as raised:
            await source.list_nearby(1.3, 103.8, 100)

        self.assertEqual(raised.exception.status_code, 502)

    def test_source_ownership(self):
        source = HdbSource(LOOKUP)
        self.assertTrue(source.owns_id("A1"))
        self.assertFalse(source.owns_id("LTA_A1"))
        self.assertFalse(source.owns_id("SUPP_A1"))


if __name__ == "__main__":
    unittest.main()
