import asyncio
import json
import math
import unittest

import httpx

from app.locations.errors import LocationServiceError
from app.locations.onemap import OneMapClient


class Clock:
    def __init__(self, value=1_700_000_000.0):
        self.value = value

    def __call__(self):
        return self.value

    def advance(self, seconds):
        self.value += seconds


class OneMapClientTests(unittest.IsolatedAsyncioTestCase):
    async def make_client(self, handler, *, email="user@example.com", password="secret"):
        clock = Clock()
        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        self.addAsyncCleanup(http.aclose)
        return OneMapClient(email, password, http=http, clock=clock), clock

    async def test_authenticates_and_reuses_token_until_five_minute_boundary(self):
        calls = []
        auth_calls = 0

        async def handler(request):
            nonlocal auth_calls
            calls.append(request)
            if request.url.path.endswith("getToken"):
                auth_calls += 1
                self.assertEqual(request.method, "POST")
                self.assertEqual(json.loads(request.content), {"email": "user@example.com", "password": "secret"})
                return httpx.Response(200, json={
                    "access_token": f"token-{auth_calls}",
                    "expiry_timestamp": "1700259200" if auth_calls == 1 else "1700259800",
                })
            self.assertIn(request.headers["Authorization"], {"token-1", "token-2"})
            return httpx.Response(200, json={"found": 1, "results": [{
                "SEARCHVAL": "Raffles Place",
                "ADDRESS": "1 Raffles Place",
                "POSTAL": "048616",
                "LATITUDE": "1.2840",
                "LONGITUDE": "103.8510",
            }]})

        client, clock = await self.make_client(handler)
        results = await client.search("raffles")
        clock.value = 1700258899
        await client.search("raffles")
        self.assertEqual(len([request for request in calls if request.url.path.endswith("getToken")]), 1)
        clock.value = 1700258900
        await client.search("raffles")
        self.assertEqual(len([request for request in calls if request.url.path.endswith("getToken")]), 2)
        self.assertEqual(results[0].label, "Raffles Place")

    async def test_renews_after_each_three_day_lifetime_and_after_idle_expiry(self):
        auth_calls = 0
        clock = Clock()

        async def handler(request):
            nonlocal auth_calls
            if request.url.path.endswith("getToken"):
                auth_calls += 1
                return httpx.Response(200, json={
                    "access_token": f"token-{auth_calls}",
                    "expiry_timestamp": str(clock() + 259200),
                })
            return httpx.Response(200, json={"found": 0, "results": []})

        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        self.addAsyncCleanup(http.aclose)
        client = OneMapClient("user@example.com", "secret", http=http, clock=clock)
        await client.search("one")
        clock.advance(259200)
        await client.search("two")
        clock.advance(259200)
        await client.search("three")
        self.assertEqual(auth_calls, 3)

    async def test_cancelled_waiter_does_not_cancel_shared_refresh(self):
        auth_started = asyncio.Event()
        release_auth = asyncio.Event()
        auth_calls = 0

        async def handler(request):
            nonlocal auth_calls
            if request.url.path.endswith("getToken"):
                auth_calls += 1
                auth_started.set()
                await release_auth.wait()
                return httpx.Response(200, json={"access_token": "shared", "expiry_timestamp": "1700259200"})
            return httpx.Response(200, json={"found": 0, "results": []})

        client, clock = await self.make_client(handler)
        first = asyncio.create_task(client.search("one"))
        await auth_started.wait()
        second = asyncio.create_task(client.search("two"))
        first.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await first
        release_auth.set()
        await second
        self.assertEqual(auth_calls, 1)

    async def test_auth_failure_is_shared_and_cooled_down(self):
        auth_calls = 0

        async def handler(request):
            nonlocal auth_calls
            auth_calls += 1
            return httpx.Response(503, text="unavailable")

        client, clock = await self.make_client(handler)
        errors = await asyncio.gather(
            client.search("one"), client.search("two"), return_exceptions=True
        )
        self.assertTrue(all(isinstance(error, LocationServiceError) for error in errors))
        self.assertEqual(auth_calls, 1)
        await self.assertRaisesAsync(LocationServiceError, client.search, "three")
        self.assertEqual(auth_calls, 1)
        clock.advance(30)
        await self.assertRaisesAsync(LocationServiceError, client.search, "four")
        self.assertEqual(auth_calls, 2)

    async def test_old_token_rejection_does_not_discard_new_token(self):
        old_started = asyncio.Event()
        second_old_seen = asyncio.Event()
        release_old = asyncio.Event()
        auth_calls = 0
        old_search_calls = 0
        seed_search = True

        async def handler(request):
            nonlocal auth_calls, old_search_calls, seed_search
            if request.url.path.endswith("getToken"):
                auth_calls += 1
                return httpx.Response(200, json={
                    "access_token": f"token-{auth_calls}",
                    "expiry_timestamp": "1700259200",
                })
            if request.headers["Authorization"] == "token-1":
                if seed_search:
                    seed_search = False
                    return httpx.Response(200, json={"found": 0, "results": []})
                old_search_calls += 1
                if old_search_calls == 1:
                    old_started.set()
                    await release_old.wait()
                else:
                    second_old_seen.set()
                return httpx.Response(401, json={"error": "Invalid token"})
            self.assertEqual(request.headers["Authorization"], "token-2")
            return httpx.Response(200, json={"found": 0, "results": []})

        client, _ = await self.make_client(handler)
        await client.search("seed")
        first = asyncio.create_task(client.search("one"))
        await old_started.wait()
        second = asyncio.create_task(client.search("two"))
        await second_old_seen.wait()
        release_old.set()
        await asyncio.gather(first, second)
        self.assertEqual(auth_calls, 2)

    async def test_normalizes_results_filters_bad_coordinates_and_limits_to_eight(self):
        async def handler(request):
            if request.url.path.endswith("getToken"):
                return httpx.Response(200, json={"access_token": "token", "expiry_timestamp": "1700259200"})
            results = [{
                "SEARCHVAL": f"Place {index}",
                "ADDRESS": f"{index} Main Road",
                "POSTAL": str(100000 + index),
                "LATITUDE": "1.3",
                "LONGITUDE": "103.8",
            } for index in range(10)]
            results.extend([
                {"SEARCHVAL": "bad nan", "LATITUDE": "nan", "LONGITUDE": "103.8"},
                {"SEARCHVAL": "bad range", "LATITUDE": "91", "LONGITUDE": "103.8"},
                {"ADDRESS": "", "LATITUDE": "1.3", "LONGITUDE": "103.8"},
            ])
            return httpx.Response(200, json={"found": len(results), "results": results})

        client, _ = await self.make_client(handler)
        results = await client.search("place")
        self.assertEqual(len(results), 8)
        self.assertEqual(results[0].address, "0 Main Road")
        self.assertTrue(all(math.isfinite(result.lat) for result in results))

    async def test_json_token_error_and_expired_search_token_are_upstream_errors(self):
        auth_calls = 0
        search_calls = 0

        async def handler(request):
            nonlocal auth_calls, search_calls
            if request.url.path.endswith("getToken"):
                auth_calls += 1
                if auth_calls == 1:
                    return httpx.Response(200, json={"error": "Authentication failed"})
                return httpx.Response(200, json={
                    "access_token": f"token-{auth_calls}",
                    "expiry_timestamp": "1700259200",
                })
            search_calls += 1
            if search_calls == 1:
                return httpx.Response(200, json={"found": 0, "results": []})
            return httpx.Response(200, json={"error": "Token expired"})

        client, clock = await self.make_client(handler)
        with self.assertRaises(LocationServiceError) as raised:
            await client.search("place")
        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(auth_calls, 1)

        clock.advance(30)
        await client.search("seed")
        with self.assertRaises(LocationServiceError) as raised:
            await client.search("place")
        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(auth_calls, 3)

    async def test_search_transport_failure_is_an_upstream_error(self):
        async def handler(request):
            if request.url.path.endswith("getToken"):
                return httpx.Response(200, json={
                    "access_token": "token",
                    "expiry_timestamp": "1700259200",
                })
            raise httpx.ConnectError("connection reset", request=request)

        client, _ = await self.make_client(handler)
        with self.assertRaises(LocationServiceError) as raised:
            await client.search("place")
        self.assertEqual(raised.exception.status_code, 502)

    async def test_missing_credentials_and_malformed_token_are_safe_failures(self):
        async def handler(request):
            self.fail("missing credentials must not call OneMap")

        client, _ = await self.make_client(handler, email="", password="")
        with self.assertRaises(LocationServiceError) as raised:
            await client.search("place")
        self.assertEqual(raised.exception.status_code, 503)

        async def malformed(request):
            return httpx.Response(200, json={"access_token": "secret-token", "expiry_timestamp": "not-a-number"})

        malformed_client, _ = await self.make_client(malformed)
        with self.assertRaises(LocationServiceError) as raised:
            await malformed_client.search("place")
        self.assertEqual(raised.exception.status_code, 502)
        self.assertNotIn("secret-token", str(raised.exception))

    async def assertRaisesAsync(self, expected, function, *args):
        with self.assertRaises(expected):
            await function(*args)


if __name__ == "__main__":
    unittest.main()
