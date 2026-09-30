import unittest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from app.main import app
from app.api import carparks


def example(cp_id, lat=1.30, lng=103.85):
    return carparks.CarparkAvailability(
        id=cp_id, name=f'Carpark {cp_id}', address='Example Singapore address',
        lat=lat, lng=lng, available_lots=12, total_lots=100, lot_types=[],
        crowd_level='high', is_sheltered=None, distance=100, night_parking=None,
        car_park_type='CAR PARK', source='lta',
    )


class AreaSearchTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.bounds = dict(north=1.31, south=1.29, east=103.86, west=103.84)

    def test_only_viewport_results_are_returned_including_edges(self):
        candidates = [example('inside'), example('edge', 1.31, 103.86),
                      example('outside', 1.312, 103.85)]
        with patch.object(carparks, 'get_nearby_carparks', new=AsyncMock(return_value=candidates)) as nearby:
            with patch.object(carparks, 'get_all_carparks', new=AsyncMock()) as all_carparks:
                response = self.client.get('/api/v1/carparks/area', params=self.bounds)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([cp['id'] for cp in response.json()], ['inside', 'edge'])
        lat, lng, radius = nearby.call_args.args
        self.assertAlmostEqual(lat, 1.30)
        self.assertAlmostEqual(lng, 103.85)
        self.assertGreaterEqual(radius, carparks._haversine(lat, lng, 1.31, 103.86))
        self.assertLess(radius, 1600)
        all_carparks.assert_not_called()

    def test_invalid_or_island_wide_bounds_do_not_fetch_upstream(self):
        for changes in [dict(north=1.28), dict(east=103.8), dict(north=91),
                        dict(north='nan'), dict(north=1.5), dict(west=103.5)]:
            with self.subTest(changes=changes), patch.object(carparks, 'get_nearby_carparks', new=AsyncMock()) as nearby:
                response = self.client.get('/api/v1/carparks/area', params={**self.bounds, **changes})
                self.assertEqual(response.status_code, 422)
                nearby.assert_not_called()

    def test_gzip_preserves_data_and_shrinks_transfer(self):
        candidates = [example(str(i)) for i in range(40)]
        with patch.object(carparks, 'get_nearby_carparks', new=AsyncMock(return_value=candidates)):
            compressed = self.client.get('/api/v1/carparks/area', params=self.bounds, headers={'Accept-Encoding': 'gzip'})
            plain = self.client.get('/api/v1/carparks/area', params=self.bounds, headers={'Accept-Encoding': 'identity'})
        self.assertEqual(compressed.headers.get('content-encoding'), 'gzip')
        self.assertNotIn('content-encoding', plain.headers)
        self.assertIn('Accept-Encoding', compressed.headers.get('vary', ''))
        self.assertEqual(compressed.json(), plain.json())
        self.assertLess(int(compressed.headers['content-length']), len(plain.content) / 5)


if __name__ == '__main__':
    unittest.main()
