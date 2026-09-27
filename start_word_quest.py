#!/usr/bin/env python3
"""Cross-platform background launcher for Kevin Word Quest.

Opening this file starts (or reuses) a detached local web server, opens the
site, and then lets the launcher process exit.  The server therefore keeps
running after its terminal window is closed.  Only Python's standard library
is required.
"""

from __future__ import annotations

import argparse
import errno
import functools
import hashlib
import hmac
import ipaddress
import json
import mimetypes
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlsplit, urlunsplit
from urllib.request import ProxyHandler, Request, build_opener
import webbrowser


APP_DIRECTORY = Path(__file__).resolve().parent
DEFAULT_BIND = "127.0.0.1"
DEFAULT_PORT = 8765
HEALTH_PATH = "/.word-quest/health"
STOP_PATH = "/.word-quest/stop"
STATE_VERSION = 1
STARTUP_TIMEOUT = 8.0
STOP_TIMEOUT = 5.0
MAX_STATE_BYTES = 64 * 1024


def port_number(value: str) -> int:
    """Argparse converter for a valid TCP port (0 requests any free port)."""

    try:
        port = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("端口必须是整数") from exc
    if not 0 <= port <= 65535:
        raise argparse.ArgumentTypeError("端口必须在 0 到 65535 之间")
    return port


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="在后台启动 Kevin Word Quest 本地单词学习网站"
    )
    parser.add_argument(
        "--port",
        type=port_number,
        default=DEFAULT_PORT,
        help=f"首选端口（默认：{DEFAULT_PORT}；填 0 可自动选择）",
    )
    parser.add_argument(
        "--bind",
        default=DEFAULT_BIND,
        metavar="ADDRESS",
        help=f"监听地址（默认：{DEFAULT_BIND}，仅本机可访问）",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="启动后不自动打开浏览器",
    )
    action = parser.add_mutually_exclusive_group()
    action.add_argument(
        "--foreground",
        action="store_true",
        help="在当前终端中运行服务器（关闭终端会停止）",
    )
    action.add_argument(
        "--status",
        action="store_true",
        help="查看后台服务器状态",
    )
    action.add_argument(
        "--stop",
        action="store_true",
        help="停止后台服务器",
    )
    action.add_argument(
        "--restart",
        action="store_true",
        help="重启后台服务器",
    )
    action.add_argument(
        "--serve",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    parser.add_argument(
        "--runtime-dir",
        type=Path,
        default=None,
        help=argparse.SUPPRESS,
    )
    return parser.parse_args(argv)


class WordQuestRequestHandler(SimpleHTTPRequestHandler):
    """Serve one static directory without permitting traversal outside it."""

    server_version = "KevinWordQuest/1.0"
    sys_version = ""

    _MIME_OVERRIDES = {
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".htm": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".map": "application/json; charset=utf-8",
        ".svg": "image/svg+xml; charset=utf-8",
        ".wasm": "application/wasm",
        ".webmanifest": "application/manifest+json; charset=utf-8",
        ".webp": "image/webp",
    }

    def __init__(self, *args: object, directory: Optional[str] = None, **kwargs: object) -> None:
        root = Path(directory) if directory is not None else APP_DIRECTORY
        self.site_root = root.resolve()
        super().__init__(*args, directory=str(self.site_root), **kwargs)

    def _send_json(self, status: HTTPStatus, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _is_loopback_client(self) -> bool:
        address = str(self.client_address[0]).split("%", 1)[0]
        try:
            parsed = ipaddress.ip_address(address)
        except ValueError:
            return False
        if parsed.is_loopback:
            return True
        return bool(
            isinstance(parsed, ipaddress.IPv6Address)
            and parsed.ipv4_mapped
            and parsed.ipv4_mapped.is_loopback
        )

    def do_GET(self) -> None:  # noqa: N802 - inherited HTTP handler API
        if urlsplit(self.path).path == HEALTH_PATH:
            self._send_json(
                HTTPStatus.OK,
                {
                    "app": "Kevin Word Quest",
                    "instance_id": getattr(self.server, "instance_id", ""),
                    "pid": os.getpid(),
                },
            )
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 - inherited HTTP handler API
        if urlsplit(self.path).path != STOP_PATH:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return

        expected = str(getattr(self.server, "control_token", ""))
        supplied = self.headers.get("X-Word-Quest-Control", "")
        if (
            not self._is_loopback_client()
            or not expected
            or not hmac.compare_digest(supplied, expected)
        ):
            self._send_json(HTTPStatus.FORBIDDEN, {"stopping": False})
            return

        self._send_json(HTTPStatus.OK, {"stopping": True})
        # BaseServer.shutdown() must run on a different thread from
        # serve_forever(), otherwise the call deadlocks.
        threading.Thread(
            target=self.server.shutdown,
            name="stop-word-quest",
            daemon=True,
        ).start()

    def log_message(self, format: str, *args: object) -> None:
        # Health polling is an implementation detail and would otherwise make
        # the persistent background log noisy.
        if urlsplit(self.path).path == HEALTH_PATH:
            return
        super().log_message(format, *args)

    def end_headers(self) -> None:
        # Development content must always reflect the files currently on disk.
        self.send_header(
            "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0"
        )
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def guess_type(self, path: str) -> str:
        suffix = Path(path).suffix.lower()
        if suffix in self._MIME_OVERRIDES:
            return self._MIME_OVERRIDES[suffix]
        content_type, _ = mimetypes.guess_type(path)
        if content_type is None:
            return "application/octet-stream"
        if content_type.startswith("text/"):
            return f"{content_type}; charset=utf-8"
        return content_type

    def _resolved_request_path(self) -> Optional[Path]:
        """Return an in-root path, or ``None`` for malformed/unsafe input."""

        raw_path = urlsplit(self.path).path
        try:
            decoded_path = unquote(raw_path, encoding="utf-8", errors="strict")
        except (UnicodeDecodeError, ValueError):
            return None

        # A backslash is a path separator on Windows. Treat it as one on every
        # platform so a URL cannot become unsafe when this script moves hosts.
        decoded_path = decoded_path.replace("\\", "/")
        if "\x00" in decoded_path:
            return None

        components = []
        for component in decoded_path.split("/"):
            if component in ("", "."):
                continue
            if component == "..":
                return None
            components.append(component)

        try:
            candidate = self.site_root.joinpath(*components).resolve()
            candidate.relative_to(self.site_root)
        except (OSError, RuntimeError, ValueError):
            # ValueError covers paths outside the root (including symlinks).
            return None
        return candidate

    def _redirect_directory(self) -> None:
        parsed = urlsplit(self.path)
        location = urlunsplit(
            (parsed.scheme, parsed.netloc, parsed.path + "/", parsed.query, parsed.fragment)
        )
        self.send_response(HTTPStatus.MOVED_PERMANENTLY)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_head(self):  # type: ignore[no-untyped-def]
        path = self._resolved_request_path()
        if path is None:
            self.send_error(HTTPStatus.FORBIDDEN, "Forbidden path")
            return None

        if path.is_dir():
            if not urlsplit(self.path).path.endswith("/"):
                self._redirect_directory()
                return None

            index_path = None
            for index_name in ("index.html", "index.htm"):
                possible_index = (path / index_name).resolve()
                try:
                    possible_index.relative_to(self.site_root)
                except ValueError:
                    continue
                if possible_index.is_file():
                    index_path = possible_index
                    break
            if index_path is None:
                # Directory listings reveal implementation details and are not
                # needed by this single-page application.
                self.send_error(HTTPStatus.NOT_FOUND, "File not found")
                return None
            path = index_path

        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None

        try:
            file_object = path.open("rb")
            file_stat = os.fstat(file_object.fileno())
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None

        try:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", self.guess_type(str(path)))
            self.send_header("Content-Length", str(file_stat.st_size))
            self.send_header("Last-Modified", self.date_time_string(file_stat.st_mtime))
            self.end_headers()
        except Exception:
            file_object.close()
            raise
        return file_object


class WordQuestHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class WordQuestIPv6HTTPServer(WordQuestHTTPServer):
    address_family = socket.AF_INET6


def _server_class(bind: str):  # type: ignore[no-untyped-def]
    return WordQuestIPv6HTTPServer if ":" in bind else WordQuestHTTPServer


def _address_is_in_use(error: OSError) -> bool:
    return error.errno in (errno.EADDRINUSE, 10048) or getattr(
        error, "winerror", None
    ) == 10048


def create_server(
    bind: str = DEFAULT_BIND,
    port: int = DEFAULT_PORT,
    directory: Path = APP_DIRECTORY,
) -> WordQuestHTTPServer:
    """Bind the preferred port, falling back atomically to an OS-selected port."""

    handler = functools.partial(WordQuestRequestHandler, directory=str(directory))
    server_type = _server_class(bind)
    try:
        server = server_type((bind, port), handler)
    except OSError as exc:
        if port == 0 or not _address_is_in_use(exc):
            raise
        server = server_type((bind, 0), handler)

    server.requested_port = port  # type: ignore[attr-defined]
    server.used_fallback_port = port not in (0, server.server_port)  # type: ignore[attr-defined]
    return server


def browser_url(bind: str, port: int) -> str:
    """Build a browser-friendly URL even when listening on a wildcard address."""

    host = bind
    if bind in ("", "0.0.0.0"):
        host = "127.0.0.1"
    elif bind == "::":
        host = "[::1]"
    elif ":" in bind and not bind.startswith("["):
        host = f"[{bind}]"
    return f"http://{host}:{port}/"


def default_runtime_directory(app_directory: Path = APP_DIRECTORY) -> Path:
    """Return a stable, project-specific directory for state and logs."""

    canonical_path = os.path.normcase(str(app_directory.resolve()))
    project_key = hashlib.sha256(canonical_path.encode("utf-8")).hexdigest()[:16]
    return Path(tempfile.gettempdir()) / f"kevin-word-quest-{project_key}"


def runtime_directory(value: Optional[Path]) -> Path:
    return value.resolve() if value is not None else default_runtime_directory()


def state_path_for(runtime: Path) -> Path:
    return runtime / "server.json"


def log_path_for(runtime: Path) -> Path:
    return runtime / "server.log"


def _read_json_file(path: Path, maximum_bytes: int = MAX_STATE_BYTES) -> Optional[Dict[str, Any]]:
    try:
        if path.stat().st_size > maximum_bytes:
            return None
        with path.open("r", encoding="utf-8") as file_object:
            value = json.load(file_object)
    except (OSError, ValueError, TypeError):
        return None
    return value if isinstance(value, dict) else None


def read_state(path: Path, app_directory: Path = APP_DIRECTORY) -> Optional[Dict[str, Any]]:
    """Read and validate launcher state without trusting a stored PID alone."""

    state = _read_json_file(path)
    if state is None:
        return None

    required_string_fields = (
        "app_root",
        "bind",
        "url",
        "instance_id",
        "control_token",
    )
    if state.get("version") != STATE_VERSION:
        return None
    if any(not isinstance(state.get(field), str) for field in required_string_fields):
        return None
    if not isinstance(state.get("pid"), int) or not isinstance(state.get("port"), int):
        return None
    if state["app_root"] != str(app_directory.resolve()):
        return None
    return state


def write_state(path: Path, state: Dict[str, Any]) -> None:
    """Atomically publish state so controllers never observe partial JSON."""

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(
        f".{path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp"
    )
    descriptor = os.open(
        str(temporary),
        os.O_WRONLY | os.O_CREAT | os.O_EXCL,
        0o600,
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as file_object:
            json.dump(state, file_object, ensure_ascii=False, sort_keys=True)
            file_object.flush()
            os.fsync(file_object.fileno())
        os.replace(str(temporary), str(path))
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    except Exception:
        try:
            temporary.unlink()
        except OSError:
            pass
        raise


def remove_state(path: Path, instance_id: Optional[str] = None) -> bool:
    """Remove state, optionally only when it still belongs to one instance."""

    if instance_id is not None:
        current = _read_json_file(path)
        if current is None or current.get("instance_id") != instance_id:
            return False
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False
    except OSError:
        return False


def _endpoint_url(base_url: str, endpoint: str) -> str:
    return base_url.rstrip("/") + endpoint


def probe_state(
    state: Optional[Dict[str, Any]],
    timeout: float = 0.6,
) -> bool:
    """Verify that state points to this exact live server instance."""

    if state is None:
        return False
    try:
        request = Request(
            _endpoint_url(state["url"], HEALTH_PATH),
            headers={"Accept": "application/json"},
        )
        opener = build_opener(ProxyHandler({}))
        with opener.open(request, timeout=timeout) as response:
            payload = json.loads(response.read(MAX_STATE_BYTES).decode("utf-8"))
        return (
            response.status == HTTPStatus.OK
            and payload.get("app") == "Kevin Word Quest"
            and payload.get("instance_id") == state["instance_id"]
        )
    except (HTTPError, URLError, OSError, ValueError, TypeError, KeyError):
        return False


def active_state(path: Path) -> Optional[Dict[str, Any]]:
    state = read_state(path)
    if probe_state(state):
        return state
    if state is not None:
        remove_state(path, state.get("instance_id"))
    elif path.exists():
        remove_state(path)
    return None


class LaunchLock:
    """Small cross-platform lock preventing duplicate servers on double-click."""

    def __init__(self, path: Path, timeout: float = STARTUP_TIMEOUT) -> None:
        self.path = path
        self.timeout = timeout
        self.token = secrets.token_hex(12)

    def __enter__(self) -> "LaunchLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                descriptor = os.open(
                    str(self.path),
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                    0o600,
                )
            except FileExistsError:
                try:
                    age = time.time() - self.path.stat().st_mtime
                    if age > max(20.0, self.timeout * 2):
                        self.path.unlink()
                        continue
                except FileNotFoundError:
                    continue
                except OSError:
                    pass
                if time.monotonic() >= deadline:
                    raise TimeoutError("等待另一个启动操作超时")
                time.sleep(0.05)
                continue

            with os.fdopen(descriptor, "w", encoding="utf-8") as file_object:
                json.dump({"pid": os.getpid(), "token": self.token}, file_object)
            return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:  # type: ignore[no-untyped-def]
        current = _read_json_file(self.path, maximum_bytes=4096)
        if current is not None and current.get("token") == self.token:
            try:
                self.path.unlink()
            except OSError:
                pass


def open_browser_now(url: str) -> None:
    """Open the ready site before the short-lived controller exits."""

    try:
        opened = webbrowser.open(url, new=2)
        if not opened:
            print(f"未找到可用浏览器，请手动打开：{url}", file=sys.stderr)
    except Exception as exc:  # Browser failure must not stop the local site.
        print(f"无法自动打开浏览器（{exc}），请手动打开：{url}", file=sys.stderr)


def open_browser_later(url: str, delay: float = 0.25) -> threading.Thread:
    """Open the site asynchronously when explicitly running in foreground."""

    def open_site() -> None:
        if delay:
            time.sleep(delay)
        open_browser_now(url)

    thread = threading.Thread(target=open_site, name="open-word-quest", daemon=True)
    thread.start()
    return thread


def _server_state(
    server: WordQuestHTTPServer,
    bind: str,
    instance_id: str,
    control_token: str,
) -> Dict[str, Any]:
    return {
        "version": STATE_VERSION,
        "app_root": str(APP_DIRECTORY.resolve()),
        "pid": os.getpid(),
        "bind": bind,
        "port": server.server_port,
        "url": browser_url(bind, server.server_port),
        "instance_id": instance_id,
        "control_token": control_token,
        "started_at": time.time(),
    }


def run_server(args: argparse.Namespace) -> int:
    """Run the HTTP service in the current process."""

    runtime = runtime_directory(args.runtime_dir)
    state_path = state_path_for(runtime)
    if args.foreground:
        existing = active_state(state_path)
        if existing is not None:
            print(f"Kevin Word Quest 已经在运行：{existing['url']}")
            if not args.no_browser:
                open_browser_now(existing["url"])
            return 0

    try:
        server = create_server(args.bind, args.port, APP_DIRECTORY)
    except OSError as exc:
        print(f"启动失败：无法监听 {args.bind}:{args.port}（{exc}）", file=sys.stderr)
        return 2

    instance_id = secrets.token_urlsafe(24)
    control_token = secrets.token_urlsafe(32)
    server.instance_id = instance_id  # type: ignore[attr-defined]
    server.control_token = control_token  # type: ignore[attr-defined]
    state = _server_state(server, args.bind, instance_id, control_token)

    try:
        write_state(state_path, state)
    except OSError as exc:
        server.server_close()
        print(f"启动失败：无法保存后台状态（{exc}）", file=sys.stderr)
        return 2

    if getattr(server, "used_fallback_port", False):
        print(
            f"端口 {args.port} 已被占用，已自动改用端口 {server.server_port}。",
            flush=True,
        )
    print(f"Kevin Word Quest 已启动：{state['url']}", flush=True)
    if args.foreground:
        print("当前为前台模式，按 Ctrl+C 可安全停止服务器。", flush=True)
        if not args.no_browser:
            open_browser_later(state["url"])

    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        if args.foreground:
            print("\n正在停止 Kevin Word Quest…", flush=True)
    finally:
        server.server_close()
        remove_state(state_path, instance_id)
    return 0


def _detached_process_kwargs(log_file):  # type: ignore[no-untyped-def]
    kwargs = {
        "stdin": subprocess.DEVNULL,
        "stdout": log_file,
        "stderr": subprocess.STDOUT,
        "cwd": str(APP_DIRECTORY),
        "close_fds": True,
    }
    if os.name == "nt":
        kwargs["creationflags"] = (
            getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
            | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
        )
    else:
        kwargs["start_new_session"] = True
    return kwargs


def _background_command(args: argparse.Namespace, runtime: Path) -> Sequence[str]:
    return (
        sys.executable,
        str(Path(__file__).resolve()),
        "--serve",
        "--no-browser",
        "--bind",
        args.bind,
        "--port",
        str(args.port),
        "--runtime-dir",
        str(runtime),
    )


def launch_background(args: argparse.Namespace) -> int:
    """Start or reuse a detached server, then let this controller exit."""

    runtime = runtime_directory(args.runtime_dir)
    state_path = state_path_for(runtime)
    log_path = log_path_for(runtime)
    lock_path = runtime / "launch.lock"

    try:
        with LaunchLock(lock_path):
            state = active_state(state_path)
            reused = state is not None
            if state is None:
                runtime.mkdir(parents=True, exist_ok=True)
                with log_path.open("ab") as log_file:
                    process = subprocess.Popen(  # noqa: S603 - fixed local command
                        _background_command(args, runtime),
                        **_detached_process_kwargs(log_file),
                    )

                deadline = time.monotonic() + STARTUP_TIMEOUT
                while time.monotonic() < deadline:
                    candidate = read_state(state_path)
                    if (
                        candidate is not None
                        and candidate.get("pid") == process.pid
                        and probe_state(candidate)
                    ):
                        state = candidate
                        break
                    if process.poll() is not None:
                        break
                    time.sleep(0.05)

                if state is None:
                    if process.poll() is None:
                        process.terminate()
                    remove_state(state_path)
                    print(
                        f"后台服务器启动失败，请查看日志：{log_path}",
                        file=sys.stderr,
                    )
                    return 2
    except (OSError, TimeoutError) as exc:
        print(f"后台服务器启动失败：{exc}", file=sys.stderr)
        return 2

    if reused:
        print(f"Kevin Word Quest 已经在后台运行：{state['url']}")
    else:
        print(f"Kevin Word Quest 已在后台启动：{state['url']}")
        print("现在可以关闭此窗口，网站仍会继续运行。")
    print(f"如需停止：{Path(__file__).name} --stop")
    if not args.no_browser:
        open_browser_now(state["url"])
    return 0


def show_status(args: argparse.Namespace) -> int:
    runtime = runtime_directory(args.runtime_dir)
    state = active_state(state_path_for(runtime))
    if state is None:
        print("Kevin Word Quest 当前没有运行。")
        return 1
    print(
        f"Kevin Word Quest 正在后台运行：{state['url']} "
        f"（PID {state['pid']}）"
    )
    return 0


def stop_background(args: argparse.Namespace) -> int:
    runtime = runtime_directory(args.runtime_dir)
    state_path = state_path_for(runtime)
    state = active_state(state_path)
    if state is None:
        print("Kevin Word Quest 当前没有运行。")
        return 0

    request = Request(
        _endpoint_url(state["url"], STOP_PATH),
        data=b"",
        headers={"X-Word-Quest-Control": state["control_token"]},
        method="POST",
    )
    try:
        opener = build_opener(ProxyHandler({}))
        with opener.open(request, timeout=2.0) as response:
            response.read(MAX_STATE_BYTES)
            if response.status != HTTPStatus.OK:
                raise OSError(f"服务器返回 {response.status}")
    except (HTTPError, URLError, OSError) as exc:
        print(f"无法安全停止后台服务器：{exc}", file=sys.stderr)
        return 2

    deadline = time.monotonic() + STOP_TIMEOUT
    while time.monotonic() < deadline:
        current = read_state(state_path)
        if current is None or current.get("instance_id") != state["instance_id"]:
            print("Kevin Word Quest 已停止。")
            return 0
        if not probe_state(state, timeout=0.2):
            remove_state(state_path, state["instance_id"])
            print("Kevin Word Quest 已停止。")
            return 0
        time.sleep(0.05)

    print("停止请求已发送，但服务器尚未退出。", file=sys.stderr)
    return 2


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    if args.status:
        return show_status(args)
    if args.stop:
        return stop_background(args)
    if args.restart:
        stopped = stop_background(args)
        if stopped != 0:
            return stopped
        return launch_background(args)
    if args.foreground or args.serve:
        return run_server(args)
    return launch_background(args)


if __name__ == "__main__":
    raise SystemExit(main())
