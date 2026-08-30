import unittest
from unittest.mock import patch

from app.api import carparks as carparks_api
from app.data.lta_carpark_lookup import LTA_CARPARK_LOOKUP
from app.data.lta_rates_lookup import canonicalise_name, lookup_rate


class RateLookupTests(unittest.TestCase):
    def test_canonicalises_formatting_and_common_bukit_abbreviation(self):
        self.assertEqual(
            canonicalise_name("Bt Panjang Plaza"),
            canonicalise_name("Bukit Panjang Plaza"),
        )
        self.assertEqual(
            canonicalise_name("Orchard Gateway"),
            canonicalise_name("orchardgateway"),
        )
        self.assertEqual(
            canonicalise_name("Kampong Kapor Road Off Street"),
            canonicalise_name("Kampong Kapor Road Off-Street"),
        )

    def test_matches_known_formatting_variants(self):
        self.assertIsNotNone(lookup_rate("Orchard Gateway"))
        self.assertIsNotNone(lookup_rate("Bt Panjang Plaza"))
        self.assertIsNotNone(lookup_rate("The Atrium@Orchard"))

    def test_lta_rate_coverage_does_not_regress(self):
        matched = sum(
            lookup_rate(info["development"]) is not None
            for info in LTA_CARPARK_LOOKUP.values()
        )
        self.assertGreaterEqual(matched, 34)


class StaticLtaFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_static_lta_locations_are_returned_without_api_key(self):
        with patch.object(carparks_api, "LTA_API_KEY", ""):
            results = await carparks_api._fetch_lta_carparks(
                1.352524,
                103.9447,
                100,
            )

        tampines_mall = next(
            (carpark for carpark in results if carpark.id == "LTA_63"),
            None,
        )
        self.assertIsNotNone(tampines_mall)
        assert tampines_mall is not None
        self.assertEqual(tampines_mall.name, "Tampines Mall")
        self.assertEqual(tampines_mall.crowd_level, "unknown")
        self.assertIsNotNone(tampines_mall.weekdays_rate_1)


if __name__ == "__main__":
    unittest.main()
