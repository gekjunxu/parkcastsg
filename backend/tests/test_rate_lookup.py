import unittest

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


if __name__ == "__main__":
    unittest.main()
