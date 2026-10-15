import unittest
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.api import locations
from app.locations.errors import LocationServiceError
from app.locations.models import LocationSuggestion
from app.main import app
import app.main as main


class LocationsApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.search = AsyncMock(return_value=[LocationSuggestion(
            label="Marina Bay Sands",
            address="10 Bayfront Avenue",
            postal="018956",
            lat=1.2834,
            lng=103.8607,
        )])
        self.fake = type("FakeLocationClient", (), {"search": self.search})()
        app.dependency_overrides[locations.get_location_client] = lambda: self.fake

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_trims_query_and_returns_normalized_suggestions(self):
        response = self.client.get("/api/v1/locations/suggest?q=%20%20marina%20%20")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["label"], "Marina Bay Sands")
        self.search.assert_awaited_once_with("marina")

    def test_empty_result_is_success(self):
        self.search.return_value = []

        response = self.client.get("/api/v1/locations/suggest?q=zzzz")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_trimmed_query_length_is_validated_before_upstream_call(self):
        for query in ("x", " " * 10, "x" * 101):
            self.search.reset_mock()
            response = self.client.get("/api/v1/locations/suggest", params={"q": query})
            self.assertEqual(response.status_code, 422, query)
            self.search.assert_not_awaited()

        response = self.client.get("/api/v1/locations/suggest", params={"q": "x" * 100})
        self.assertEqual(response.status_code, 200)

    def test_translates_configuration_and_upstream_failures(self):
        self.search.side_effect = LocationServiceError(503, "OneMap is not configured")
        response = self.client.get("/api/v1/locations/suggest?q=marina")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "OneMap is not configured")

        self.search.side_effect = LocationServiceError(502, "OneMap service unavailable")
        response = self.client.get("/api/v1/locations/suggest?q=marina")
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], "OneMap service unavailable")

    def test_public_base_path_and_route_order_are_preserved(self):
        with unittest.mock.patch.object(main, "app_base_path", "/parkcastsit"):
            response = self.client.get("/parkcastsit/api/v1/locations/suggest?q=marina")

        self.assertEqual(response.status_code, 200)
        route_names = [getattr(route, "name", None) for route in locations.router.routes]
        self.assertLess(route_names.index("suggest_locations"), len(route_names))
        frontend_index = next(
            (index for index, route in enumerate(app.routes) if getattr(route, "path", None) == "/{full_path:path}"),
            None,
        )
        route_index = next(
            (index for index, route in enumerate(app.routes) if getattr(route, "endpoint", None) is locations.suggest_locations),
            None,
        )
        if frontend_index is not None:
            self.assertLess(route_index, frontend_index)


class ApplicationLifespanTests(unittest.IsolatedAsyncioTestCase):
    async def test_lifespan_owns_and_closes_one_map_http_client(self):
        async with app.router.lifespan_context(app):
            client = app.state.onemap_client
            self.assertFalse(client.http.is_closed)
        self.assertTrue(client.http.is_closed)


if __name__ == "__main__":
    unittest.main()
