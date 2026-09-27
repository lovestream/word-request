"""Tests for the standard-library Kevin Word Quest launcher."""

from __future__ import annotations

from contextlib import redirect_stderr
import io
import json
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

import start_word_quest as launcher  # noqa: E402


class ArgumentTests(unittest.TestCase):
    def test_defaults(self) -> None:
        args = launcher.parse_args([])
        self.assertEqual(args.port, 8765)
        self.assertEqual(args.bind, "127.0.0.1")
        self.assertFalse(args.no_browser)
        self.assertFalse(args.foreground)
        self.assertFalse(args.status)
        self.assertFalse(args.stop)
        self.assertFalse(args.restart)
        self.assertFalse(args.serve)

    def test_custom_arguments(self) -> None:
        args = launcher.parse_args(
            ["--port", "9000", "--bind", "0.0.0.0", "--no-browser"]
        )
        self.assertEqual(args.port, 9000)
        self.assertEqual(args.bind, "0.0.0.0")
        self.assertTrue(args.no_browser)

    def test_invalid_port_is_rejected(self) -> None:
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            launcher.parse_args(["--port", "65536"])

    def test_actions_are_mutually_exclusive(self) -> None:
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            launcher.parse_args(["--foreground", "--stop"])


class RunningServerTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_directory.name) / "site"
        self.root.mkdir()
        (self.root / "index.html").write_text(
            "<!doctype html><title>Kevin Word Quest</title>", encoding="utf-8"
        )
        (self.root / "app.js").write_text("console.log('ready');", encoding="utf-8")
        (self.root / "picture.webp").write_bytes(b"RIFF")
        self.server = launcher.create_server("127.0.0.1", 0, self.root)
        self.server.instance_id = "test-instance"
        self.server.control_token = "test-control-token"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp_directory.cleanup()

    def test_basic_http_and_no_cache_headers(self) -> None:
        with urlopen(self.base_url + "/", timeout=2) as response:
            body = response.read().decode("utf-8")
            self.assertEqual(response.status, 200)
            self.assertIn("Kevin Word Quest", body)
            self.assertEqual(response.headers.get_content_type(), "text/html")
            self.assertIn("no-store", response.headers["Cache-Control"])
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")

        with urlopen(self.base_url + "/app.js", timeout=2) as response:
            self.assertEqual(response.headers.get_content_type(), "application/javascript")

        with urlopen(self.base_url + "/picture.webp", timeout=2) as response:
            self.assertEqual(response.headers.get_content_type(), "image/webp")

    def test_missing_file_returns_404(self) -> None:
        with self.assertRaises(HTTPError) as raised:
            urlopen(self.base_url + "/missing-file.html", timeout=2)
        self.assertEqual(raised.exception.code, 404)

    def test_health_identifies_the_exact_server_instance(self) -> None:
        with urlopen(self.base_url + launcher.HEALTH_PATH, timeout=2) as response:
            payload = json.loads(response.read().decode("utf-8"))
        self.assertEqual(payload["app"], "Kevin Word Quest")
        self.assertEqual(payload["instance_id"], "test-instance")

    def test_stop_rejects_the_wrong_control_token(self) -> None:
        request = Request(
            self.base_url + launcher.STOP_PATH,
            data=b"",
            headers={"X-Word-Quest-Control": "wrong-token"},
            method="POST",
        )
        with self.assertRaises(HTTPError) as raised:
            urlopen(request, timeout=2)
        self.assertEqual(raised.exception.code, 403)
        self.assertTrue(self.thread.is_alive())

    def test_encoded_parent_traversal_is_forbidden(self) -> None:
        secret = Path(self.temp_directory.name) / "secret.txt"
        secret.write_text("must not leak", encoding="utf-8")
        with self.assertRaises(HTTPError) as raised:
            urlopen(self.base_url + "/%2e%2e/secret.txt", timeout=2)
        self.assertEqual(raised.exception.code, 403)

    def test_backslash_parent_traversal_is_forbidden(self) -> None:
        with self.assertRaises(HTTPError) as raised:
            urlopen(self.base_url + "/%2e%2e%5csecret.txt", timeout=2)
        self.assertEqual(raised.exception.code, 403)


class PortFallbackTests(unittest.TestCase):
    def test_occupied_preferred_port_uses_an_available_port(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            (root / "index.html").write_text("ready", encoding="utf-8")
            blocker = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            blocker.bind(("127.0.0.1", 0))
            blocker.listen(1)
            occupied_port = blocker.getsockname()[1]

            server = None
            try:
                server = launcher.create_server("127.0.0.1", occupied_port, root)
                self.assertNotEqual(server.server_port, occupied_port)
                self.assertTrue(server.used_fallback_port)
            finally:
                if server is not None:
                    server.server_close()
                blocker.close()


class StateFileTests(unittest.TestCase):
    def test_state_round_trip_and_instance_safe_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "server.json"
            state = {
                "version": launcher.STATE_VERSION,
                "app_root": str(launcher.APP_DIRECTORY.resolve()),
                "pid": 123,
                "bind": "127.0.0.1",
                "port": 8765,
                "url": "http://127.0.0.1:8765/",
                "instance_id": "new-instance",
                "control_token": "secret",
            }
            launcher.write_state(path, state)
            self.assertEqual(launcher.read_state(path), state)
            self.assertFalse(launcher.remove_state(path, "old-instance"))
            self.assertTrue(path.exists())
            self.assertTrue(launcher.remove_state(path, "new-instance"))

    def test_malformed_or_wrong_project_state_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "server.json"
            path.write_text("{broken", encoding="utf-8")
            self.assertIsNone(launcher.read_state(path))

            state = {
                "version": launcher.STATE_VERSION,
                "app_root": "/another/project",
                "pid": 123,
                "bind": "127.0.0.1",
                "port": 8765,
                "url": "http://127.0.0.1:8765/",
                "instance_id": "instance",
                "control_token": "secret",
            }
            launcher.write_state(path, state)
            self.assertIsNone(launcher.read_state(path))


class ProcessConfigurationTests(unittest.TestCase):
    def test_detached_child_never_inherits_the_terminal(self) -> None:
        log_file = io.BytesIO()
        with mock.patch.object(launcher.os, "name", "posix"):
            kwargs = launcher._detached_process_kwargs(log_file)
        self.assertIs(kwargs["stdin"], launcher.subprocess.DEVNULL)
        self.assertIs(kwargs["stdout"], log_file)
        self.assertIs(kwargs["stderr"], launcher.subprocess.STDOUT)
        self.assertTrue(kwargs["start_new_session"])

    def test_background_command_never_opens_a_second_browser(self) -> None:
        args = launcher.parse_args(["--port", "0"])
        command = launcher._background_command(args, Path("/tmp/word-quest-test"))
        self.assertIn("--serve", command)
        self.assertIn("--no-browser", command)


class BackgroundLifecycleTests(unittest.TestCase):
    def test_launcher_returns_while_server_stays_alive_and_can_be_stopped(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            runtime = Path(temporary_directory) / "runtime"
            common = [
                "--runtime-dir",
                str(runtime),
                "--port",
                "0",
                "--no-browser",
            ]

            try:
                started_at = time.monotonic()
                self.assertEqual(launcher.main(common), 0)
                self.assertLess(time.monotonic() - started_at, launcher.STARTUP_TIMEOUT)

                state_path = launcher.state_path_for(runtime)
                first_state = launcher.read_state(state_path)
                self.assertTrue(launcher.probe_state(first_state))

                self.assertEqual(launcher.main(common), 0)
                second_state = launcher.read_state(state_path)
                self.assertEqual(first_state["pid"], second_state["pid"])
                self.assertEqual(first_state["url"], second_state["url"])

                self.assertEqual(launcher.main(common + ["--status"]), 0)
                self.assertEqual(launcher.main(common + ["--restart"]), 0)
                restarted_state = launcher.read_state(state_path)
                self.assertNotEqual(
                    first_state["instance_id"],
                    restarted_state["instance_id"],
                )
                self.assertTrue(launcher.probe_state(restarted_state))
                self.assertEqual(launcher.main(common + ["--stop"]), 0)
                self.assertFalse(state_path.exists())
                self.assertFalse(launcher.probe_state(restarted_state, timeout=0.2))
            finally:
                launcher.main(common + ["--stop"])


if __name__ == "__main__":
    unittest.main()
