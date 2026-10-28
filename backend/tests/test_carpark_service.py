import unittest
from unittest.mock import AsyncMock

from app.carparks.models import CarparkAvailability
from app.carparks.service import CarparkService


def carpark(
    carpark_id: str,
    source: str,
    name: str,
    distance: int = 100,
    lat: float = 1.3,
    lng: float = 103.85,
) -> CarparkAvailability:
    return CarparkAvailability(
        id=carpark_id,
        name=name,
        address=name,
        lat=lat,
        lng=lng,
        available_lots=10,
        total_lots=100,
        lot_types=[],
        crowd_level="high",
        is_sheltered=None,
        distance=distance,
        night_parking=None,
        car_park_type="CAR PARK",
        source=source,
    )


class FakeSource:
    def __init__(self, source_name, nearby, details=None, owned_prefix=None):
        self.source_name = source_name
        self.nearby_results = nearby
        self.details = details or {}
        self.owned_prefix = owned_prefix
        self.list_nearby = AsyncMock(return_value=nearby)

    def owns_id(self, carpark_id):
        return self.owned_prefix is not None and carpark_id.startswith(self.owned_prefix)

    async def get_by_id(self, carpark_id, lat, lng):
        return self.details[carpark_id]


class CarparkServiceTests(unittest.IsolatedAsyncioTestCase):
    def test_source_priority_places_ura_between_lta_and_supplemental(self):
        sources = [
            FakeSource("supplemental", []),
            FakeSource("ura", []),
            FakeSource("lta", []),
            FakeSource("hdb", []),
        ]

        self.assertEqual(
            [source.source_name for source in CarparkService(sources).sources],
            ["hdb", "lta", "ura", "supplemental"],
        )

    def setUp(self):
        self.hdb = FakeSource(
            "hdb",
            [
                carpark("DUP", "hdb", "HDB Duplicate", 50),
                carpark("HDB_ONLY", "hdb", "HDB Only", 10),
            ],
            owned_prefix="HDB_",
        )
        self.lta = FakeSource(
            "lta",
            [carpark("LTA_1", "lta", "Same As LTA Development", 30)],
            details={"LTA_1": carpark("LTA_1", "lta", "Same As LTA Development")},
            owned_prefix="LTA_",
        )
        self.supplemental = FakeSource(
            "supplemental",
            [
                carpark("DUP", "supplemental", "Different Duplicate", 20),
                carpark("SUPP_DUPLICATE_NAME", "supplemental", "Same As LTA Development", 40),
                carpark("SUPP_KEEP", "supplemental", "Keep Me", 5),
            ],
            details={
                "SUPP_DUPLICATE_NAME": carpark(
                    "SUPP_DUPLICATE_NAME", "supplemental", "Same As LTA Development"
                )
            },
            owned_prefix="SUPP_",
        )
        self.service = CarparkService([self.hdb, self.lta, self.supplemental])

    async def test_nearby_applies_source_priority_suppression_and_distance_order(self):
        results = await self.service.nearby(1.3, 103.85, 500)
        self.assertEqual(
            [result.id for result in results],
            ["SUPP_KEEP", "HDB_ONLY", "LTA_1", "DUP"],
        )
        self.assertEqual(next(result for result in results if result.id == "DUP").source, "hdb")

    async def test_detail_dispatch_does_not_apply_list_suppression(self):
        result = await self.service.get_by_id("SUPP_DUPLICATE_NAME", None, None)
        self.assertEqual(result.source, "supplemental")
        self.supplemental.get_by_id = AsyncMock(return_value=result)
        await self.service.get_by_id("SUPP_DUPLICATE_NAME", None, None)
        self.supplemental.get_by_id.assert_called_once()

    async def test_all_uses_singapore_center_and_sorts_by_id(self):
        result = await self.service.all()
        self.assertEqual([item.id for item in result], ["DUP", "HDB_ONLY", "LTA_1", "SUPP_KEEP"])
        for source in (self.hdb, self.lta, self.supplemental):
            args = source.list_nearby.call_args.args
            self.assertAlmostEqual(args[0], 1.3521)
            self.assertAlmostEqual(args[1], 103.8198)
            self.assertEqual(args[2], 100_000)

    async def test_area_keeps_inclusive_edges(self):
        self.hdb.list_nearby = AsyncMock(
            return_value=[
                carpark("inside", "hdb", "Inside", lat=1.30, lng=103.85),
                carpark("edge", "hdb", "Edge", lat=1.31, lng=103.86),
                carpark("outside", "hdb", "Outside", lat=1.312, lng=103.85),
            ]
        )
        self.lta.list_nearby = AsyncMock(return_value=[])
        self.supplemental.list_nearby = AsyncMock(return_value=[])
        result = await self.service.area(1.31, 1.29, 103.86, 103.84)
        self.assertEqual([item.id for item in result], ["inside", "edge"])

    async def test_area_rejects_invalid_and_oversized_bounds(self):
        for bounds in [
            (1.28, 1.29, 103.86, 103.84),
            (91, 1.29, 103.86, 103.84),
            (1.31, 1.29, 103.8, 103.84),
            (1.5, 1.29, 103.86, 103.84),
        ]:
            with self.subTest(bounds=bounds):
                with self.assertRaises(ValueError):
                    await self.service.area(*bounds)
        self.hdb.list_nearby.assert_not_called()


if __name__ == "__main__":
    unittest.main()
