import json
import importlib.util
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from dotenv import dotenv_values

_SCRIPT = Path(__file__).with_name("write-runtime-env.py")
_SPEC = importlib.util.spec_from_file_location("write_runtime_env", _SCRIPT)
assert _SPEC and _SPEC.loader
_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)
write_runtime_env = _MODULE.write_runtime_env


class RuntimeEnvTests(unittest.TestCase):
    def test_rejects_missing_onemap_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "ONEMAP_API_EMAIL.*ONEMAP_API_PASSWORD"):
                write_runtime_env(
                    Path(directory) / ".env",
                    port="0",
                    app_base_path="/parkcastsit",
                    vite_base_path="/parkcastsit/",
                    environment={
                        **os.environ,
                        "ONEMAP_API_EMAIL": "",
                        "ONEMAP_API_PASSWORD": "",
                    },
                )

    def test_special_characters_round_trip_and_file_is_private(self):
        values = {
            "LTA_API_KEY": "lta-$-key#\\path",
            "URA_API_KEY": "ura-$-key#\\path",
            "CORS_ALLOW_ORIGINS": "https://example.test/#park",
            "ONEMAP_API_EMAIL": "one+test@example.com",
            "ONEMAP_API_PASSWORD": "p@$$'word#\\path",
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            write_runtime_env(
                path,
                port="0",
                app_base_path="/parkcastsit",
                vite_base_path="/parkcastsit/",
                environment={**os.environ, **values},
            )

            parsed = dotenv_values(path)
            self.assertEqual({key: parsed[key] for key in values}, values)
            self.assertEqual(parsed["PARKCAST_PORT"], "0")
            self.assertEqual(parsed["APP_BASE_PATH"], "/parkcastsit")
            self.assertEqual(parsed["VITE_BASE_PATH"], "/parkcastsit/")
            if os.name != "nt":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_rejects_multiline_values(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                write_runtime_env(
                    Path(directory) / ".env",
                    port="0",
                    app_base_path="/parkcastsit",
                    vite_base_path="/parkcastsit/",
                    environment={**os.environ, "ONEMAP_API_PASSWORD": "line1\nline2"},
                )

    @unittest.skipUnless(shutil.which("docker"), "Docker is required for Compose forwarding verification")
    def test_compose_forwards_runtime_api_variables(self):
        values = {
            "ONEMAP_API_EMAIL": "compose+test@example.com",
            "ONEMAP_API_PASSWORD": "compose-$'secret#\\path",
            "URA_API_KEY": "compose-ura-key",
        }
        repository = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            write_runtime_env(
                env_file,
                port="0",
                app_base_path="/parkcastsit",
                vite_base_path="/parkcastsit/",
                environment={**os.environ, **values},
            )
            result = subprocess.run(
                ["docker", "compose", "--env-file", str(env_file), "config", "--format", "json"],
                cwd=repository,
                check=True,
                capture_output=True,
                text=True,
            )
            config = json.loads(result.stdout)
            service_environment = config["services"]["parkcastsg"]["environment"]
            self.assertEqual(service_environment["ONEMAP_API_EMAIL"], values["ONEMAP_API_EMAIL"])
            # `docker compose config` doubles literal dollars in its normalized
            # output so the rendered config remains safe to re-parse.
            self.assertEqual(service_environment["ONEMAP_API_PASSWORD"].replace("$$", "$"), values["ONEMAP_API_PASSWORD"])
            self.assertEqual(service_environment["URA_API_KEY"], values["URA_API_KEY"])
            self.assertNotIn(values["ONEMAP_API_PASSWORD"], result.stderr)


if __name__ == "__main__":
    unittest.main()

