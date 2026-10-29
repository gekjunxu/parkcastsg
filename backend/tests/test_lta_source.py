import unittest

import httpx

from app.carparks.errors import CarparkNotFoundError
from app.carparks.sources.lta import LtaSource


LOOKUP = {
    "CP1": {"development": "Example Mall", "lat": 1.3000, "lng": 103.8000},
    "CP2": {"development": "Other Mall", "lat": 1.3010, "lng": 103.8010},
}
RATES = lambda name: {
    "weekdays_rate_1": "$1",
    "weekdays_rate_2": "-",
    "saturday_rate": "",
    "sunday_ph_rate": "$2",
}


class LtaSourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_no_static_candidates_skips_live_request(self):
        calls = 0

        async def handler(request):
            nonlocal calls
            calls += 1
            return httpx.Response(200, json={"value": []})

        source = LtaSource(
            LOOKUP,
            RATES,
            "key",
            transport=httpx.MockTransport(handler),
        )
        self.assertEqual(await source.list_nearby(1.5, 103.9, 10), [])
        self.assertEqual(calls, 0)

    async def test_live_zero_is_full_and_missing_entry_is_unknown(self):
        async def handler(request):
            return httpx.Response(
                200,
                json={
                    "value": [
                        {"CarParkID": "CP1", "Agency": "URA", "LotType": "C", "AvailableLots": 0},
                    ]
                },
            )

        source = LtaSource(
            LOOKUP,
            RATES,
            "key",
            transport=httpx.MockTransport(handler),
        )
        results = await source.list_nearby(1.3, 103.8, 1000)
        by_id = {result.id: result for result in results}

        self.assertEqual(by_id["LTA_CP1"].available_lots, 0)
        self.assertEqual(by_id["LTA_CP1"].crowd_level, "full")
        self.assertEqual(by_id["LTA_CP2"].crowd_level, "unknown")
        self.assertIsNotNone(by_id["LTA_CP1"].availability_timestamp)
        self.assertIsNone(by_id["LTA_CP2"].availability_timestamp)

    async def test_hdb_entries_are_excluded_and_rates_are_normalized(self):
        async def handler(request):
            return httpx.Response(
                200,
                json={
                    "value": [
                        {"CarParkID": "CP1", "Agency": "HDB", "LotType": "C", "AvailableLots": 99},
                        {"CarParkID": "CP1", "Agency": "URA", "LotType": "C", "AvailableLots": 7},
                        {"CarParkID": "CP1", "Agency": "URA", "LotType": "M", "AvailableLots": 100},
                    ]
                },
            )

        source = LtaSource(
            LOOKUP,
            RATES,
            "key",
            transport=httpx.MockTransport(handler),
        )
        result = (await source.list_nearby(1.3, 103.8, 1000))[0]
        self.assertEqual(result.id, "LTA_CP1")
        self.assertEqual(result.available_lots, 7)
        self.assertEqual(result.weekdays_rate_1, "$1")
        self.assertIsNone(result.weekdays_rate_2)

    async def test_upstream_failure_falls_back_to_static_details_and_logs_warning(self):
        async def handler(request):
            return httpx.Response(503, text="unavailable")

        source = LtaSource(
            LOOKUP,
            RATES,
            "key",
            transport=httpx.MockTransport(handler),
        )
        with self.assertLogs(level="WARNING") as logs:
            result = await source.get_by_id("LTA_CP1", None, None)

        self.assertEqual(result.crowd_level, "unknown")
        joined = "\n".join(logs.output)
        self.assertIn("source=lta", joined)
        self.assertIn("operation=get_by_id", joined)

    async def test_missing_api_key_uses_static_fallback(self):
        source = LtaSource(LOOKUP, RATES, "")
        result = await source.get_by_id("LTA_CP1", None, None)
        self.assertEqual(result.crowd_level, "unknown")

    async def test_unknown_id_is_404(self):
        source = LtaSource(LOOKUP, RATES, "")
        with self.assertRaises(CarparkNotFoundError) as raised:
            await source.get_by_id("LTA_MISSING", None, None)
        self.assertEqual(raised.exception.status_code, 404)

    def test_source_ownership(self):
        source = LtaSource(LOOKUP, RATES, "")
        self.assertEqual(source.id_prefix, "LTA_")


if __name__ == "__main__":
    unittest.main()
