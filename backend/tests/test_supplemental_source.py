import unittest

from app.carparks.errors import CarparkNotFoundError
from app.carparks.sources.supplemental import SupplementalSource


SLASH_ID = "SUPP_KEPPEL_BAY_TOWER_/_HARBOURFRONT_TOWER_ONE"
LOOKUP = {
    "keppel bay tower / harbourfront tower one": {
        "name": "Keppel Bay Tower / Harbourfront Tower One",
        "lat": 1.264293,
        "lng": 103.822305,
    },
    "same as lta development": {
        "name": "Same As LTA Development",
        "lat": 1.3000,
        "lng": 103.8000,
    },
}
ID_LOOKUP = {
    SLASH_ID: "keppel bay tower / harbourfront tower one",
    "SUPP_SAME_AS_LTA_DEVELOPMENT": "same as lta development",
}


class SupplementalSourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_list_and_detail_preserve_slash_containing_id(self):
        source = SupplementalSource(LOOKUP, ID_LOOKUP, lambda name: {"weekdays_rate_1": "$2"})
        results = await source.list_nearby(1.264293, 103.822305, 10)
        detail = await source.get_by_id(SLASH_ID, 1.264293, 103.822305)

        self.assertEqual(results[0].id, SLASH_ID)
        self.assertEqual(detail.id, SLASH_ID)
        self.assertEqual(detail.crowd_level, "unknown")
        self.assertEqual(detail.weekdays_rate_1, "$2")

    async def test_adapter_does_not_suppress_names_that_match_another_source(self):
        source = SupplementalSource(LOOKUP, ID_LOOKUP, lambda name: None)
        results = await source.list_nearby(1.3, 103.8, 10)
        self.assertIn("SUPP_SAME_AS_LTA_DEVELOPMENT", {result.id for result in results})

    async def test_unknown_id_is_404(self):
        source = SupplementalSource(LOOKUP, ID_LOOKUP, lambda name: None)
        with self.assertRaises(CarparkNotFoundError) as raised:
            await source.get_by_id("SUPP_MISSING", None, None)
        self.assertEqual(raised.exception.status_code, 404)

    def test_source_ownership(self):
        source = SupplementalSource(LOOKUP, ID_LOOKUP, lambda name: None)
        self.assertEqual(source.id_prefix, "SUPP_")


if __name__ == "__main__":
    unittest.main()
