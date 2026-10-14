import inspect
import unittest

from app.carparks.errors import CarparkNotFoundError, CarparkSourceError
from app.carparks.helpers import (
    canonicalise_name,
    crowd_level,
    crowd_level_absolute,
    haversine,
    normalize_lot_types,
    rate_field,
)
from app.carparks.models import CarparkAvailability, LotTypeAvailability
from app.carparks.sources.base import CarparkSource
from app.data.lta_rates_lookup import canonicalise_name as legacy_canonicalise_name


class CarparkFoundationTests(unittest.TestCase):
    def test_models_preserve_api_fields_and_defaults(self):
        model = CarparkAvailability(
            id="LTA_1",
            name="Example",
            address="Example",
            lat=1.3,
            lng=103.8,
            available_lots=0,
            total_lots=0,
            lot_types=[],
            crowd_level="unknown",
            is_sheltered=None,
            distance=0,
            night_parking=None,
            car_park_type="CAR PARK",
            source="lta",
        )

        self.assertEqual(model.free_parking, "NO")
        self.assertEqual(model.short_term_parking, "WHOLE DAY")
        self.assertFalse(model.is_central)
        self.assertFalse(model.is_peak)
        self.assertIsNone(model.weekdays_rate_1)
        self.assertIsNone(model.availability_timestamp)
        self.assertEqual(LotTypeAvailability(lot_type="C", available_lots=1, total_lots=2).lot_type, "C")

    def test_helpers_match_existing_behavior(self):
        self.assertEqual(haversine(1.3, 103.8, 1.3, 103.8), 0)
        self.assertEqual(crowd_level(0, 0), "full")
        self.assertEqual(crowd_level(60, 100), "low")
        self.assertEqual(crowd_level(30, 100), "medium")
        self.assertEqual(crowd_level(10, 100), "high")
        self.assertEqual(crowd_level_absolute(0), "full")
        self.assertEqual(crowd_level_absolute(51), "low")
        self.assertEqual(crowd_level_absolute(21), "medium")
        self.assertEqual(crowd_level_absolute(20), "high")
        self.assertEqual(rate_field("  $2  "), "$2")
        self.assertIsNone(rate_field("-"))
        self.assertEqual(
            normalize_lot_types([{"lot_type": "C", "lots_available": "1", "total_lots": "2"}]),
            [LotTypeAvailability(lot_type="C", available_lots=1, total_lots=2)],
        )
        self.assertEqual(canonicalise_name("Bt Panjang Plaza"), "bukitpanjangplaza")
        self.assertEqual(canonicalise_name("The Orchard Gateway"), "orchardgateway")
        self.assertEqual(legacy_canonicalise_name("Bt Panjang Plaza"), canonicalise_name("Bt Panjang Plaza"))

    def test_source_protocol_declares_the_adapter_contract(self):
        self.assertIn("source_name", CarparkSource.__annotations__)
        for method_name in ("owns_id", "list_nearby", "get_by_id"):
            self.assertTrue(callable(getattr(CarparkSource, method_name)))
            self.assertIsNotNone(inspect.signature(getattr(CarparkSource, method_name)))

    def test_source_errors_expose_status_and_context(self):
        error = CarparkSourceError("hdb", "get_by_id", "ABC", 502, "upstream failed")
        self.assertEqual((error.source_name, error.operation, error.carpark_id), ("hdb", "get_by_id", "ABC"))
        self.assertEqual((error.status_code, error.detail), (502, "upstream failed"))

        not_found = CarparkNotFoundError("supplemental", "get_by_id", "SUPP_X", "missing")
        self.assertEqual(not_found.status_code, 404)


if __name__ == "__main__":
    unittest.main()
