import unittest
from unittest.mock import patch

from app.api import carparks as carparks_api
from app.data.lta_carpark_lookup import LTA_CARPARK_LOOKUP
from app.data.lta_rates_lookup import canonicalise_name, lookup_rate
from app.data.supplemental_carpark_lookup import SUPPLEMENTAL_CARPARK_LOOKUP


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

    def test_downtown_east_uses_the_published_2026_rates(self):
        rates = lookup_rate("Downtown East")

        self.assertIsNotNone(rates)
        assert rates is not None
        self.assertIn("$0.028 per min", rates["weekdays_rate_1"])
        self.assertIn("$2.45 per entry", rates["weekdays_rate_1"])
        self.assertIn("$0.030 per min", rates["weekdays_rate_1"])
        self.assertIn("$3.40 per entry", rates["weekdays_rate_1"])
        self.assertIn("$16.00", rates["weekdays_rate_2"])
        self.assertIn("$20.00", rates["weekdays_rate_2"])

    def test_harbourfront_uses_current_lta_rates(self):
        rates = lookup_rate("Harbourfront Centre")

        self.assertIsNotNone(rates)
        assert rates is not None
        self.assertIn("$1.60 for 1st hr", rates["weekdays_rate_1"])
        self.assertIn("$3.20 per entry", rates["weekdays_rate_2"])
        self.assertIn("$1.80 for 1st hr", rates["saturday_rate"])
        self.assertIn("$3.50 per entry", rates["saturday_rate"])

    def test_ikea_alexandra_uses_current_published_parking_rate(self):
        rates = lookup_rate("IKEA (Alexandra)")

        self.assertIsNotNone(rates)
        assert rates is not None
        self.assertIn("$0.06 per min", rates["weekdays_rate_1"])
        self.assertIn("3 hours free", rates["weekdays_rate_1"])

    def test_ikea_tampines_rate_matches_current_published_parking(self):
        rates = lookup_rate("IKEA (Tampines)")

        self.assertIsNotNone(rates)
        assert rates is not None
        self.assertIn("free parking", rates["weekdays_rate_1"].lower())
        self.assertIn("no maximum stay", rates["weekdays_rate_1"].lower())


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

    async def test_harbourfront_detail_is_available_without_lta_api_key(self):
        with patch.object(carparks_api, "LTA_API_KEY", ""):
            harbourfront = await carparks_api._get_lta_carpark("LTA_19", None, None)

        self.assertEqual(harbourfront.name, "Harbourfront Centre")
        self.assertEqual(harbourfront.crowd_level, "unknown")
        self.assertIsNone(harbourfront.availability_timestamp)
        self.assertIn("$1.60 for 1st hr", harbourfront.weekdays_rate_1)


class SupplementalLocationTests(unittest.TestCase):
    def test_ikea_alexandra_is_not_geocoded_to_ikea_tampines(self):
        alexandra = SUPPLEMENTAL_CARPARK_LOOKUP["ikea (alexandra)"]
        tampines = SUPPLEMENTAL_CARPARK_LOOKUP["ikea (tampines)"]

        self.assertAlmostEqual(alexandra["lat"], 1.288183, places=4)
        self.assertAlmostEqual(alexandra["lng"], 103.805664, places=4)
        self.assertGreater(abs(alexandra["lat"] - tampines["lat"]), 0.05)


if __name__ == "__main__":
    unittest.main()
