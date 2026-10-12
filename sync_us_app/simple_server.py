from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from logging.handlers import RotatingFileHandler
from urllib.parse import parse_qs, unquote, urlparse
import base64
import gzip
import hmac
import json
import logging
import mimetypes
import os
import sys
import threading

from . import config, planner, services
from .config import AUTH_ENABLED, AUTH_PASSWORD, AUTH_USER, FRONTEND_DIR, FRONTEND_DIST_DIR, INDEX_PATH
from .database import init_db
from .maintenance import latest_backup_age, run_maintenance_once, start_maintenance

logger = logging.getLogger("sync_us")

MAX_BODY_BYTES = 4 * 1024 * 1024  # a compressed photo is about 1.5 MB as text
GZIP_MIN_BYTES = 1024
COMPRESSIBLE_TYPES = (
    "text/",
    "application/json",
    "application/javascript",
    "application/manifest+json",
    "image/svg+xml",
)
# Served without the Basic Auth prompt: browsers fetch these without credentials when
# installing the app to the home screen, and none of them contain personal data.
PUBLIC_FILES = {
    "/manifest.webmanifest",
    "/robots.txt",
    "/favicon.svg",
    "/apple-touch-icon.png",
}
PUBLIC_PREFIXES = ("/icons/",)
QUIET_PATHS = ("/api/v1/version", "/robots.txt")
PLANNER_PREFIX = "/api/v1/planner/"

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")

_static_cache: dict = {}
_static_lock = threading.Lock()
_logging_configured = False


class RequestTooLarge(Exception):
    pass


class SyncUsServer(ThreadingHTTPServer):
    daemon_threads = True
    # On Windows SO_REUSEADDR lets a second copy bind the same port and silently steal
    # requests; without it, starting Sync-Us twice fails clearly instead.
    allow_reuse_address = os.name != "nt"


class SyncUsRequestHandler(BaseHTTPRequestHandler):
    # HTTP/1.1 keeps connections open between requests (Cloudflare Tunnel reuses them).
    protocol_version = "HTTP/1.1"
    server_version = "Sync-Us"
    sys_version = ""
    # Seconds an idle keep-alive connection may stay open. Longer than cloudflared's 90 s
    # origin keep-alive, so the tunnel closes idle connections first (no race on reuse).
    timeout = 120

    def log_message(self, fmt, *args):
        logger.info(fmt % args)

    def log_error(self, fmt, *args):
        message = fmt % args
        if message.startswith("Request timed out"):
            logger.debug(message)  # an idle keep-alive connection closing: normal
            return
        logger.warning(message)

    def log_request(self, code="-", size="-"):
        # Every open screen polls /version every few seconds; logging each successful poll
        # would bury the lines that matter when something goes wrong.
        value = getattr(code, "value", code)
        if value in (200, 304) and self.path.startswith(QUIET_PATHS):
            return
        super().log_request(code, size)

    # --- auth -----------------------------------------------------------------------

    def _authorized(self) -> bool:
        if not AUTH_ENABLED:
            return True
        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return False
        try:
            user, _, password = base64.b64decode(header[6:]).decode("utf-8").partition(":")
        except (ValueError, UnicodeDecodeError):
            return False
        # Compare as bytes: compare_digest only accepts ASCII str, and passwords may be Chinese.
        user_ok = hmac.compare_digest(user.encode("utf-8"), AUTH_USER.encode("utf-8"))
        password_ok = hmac.compare_digest(password.encode("utf-8"), AUTH_PASSWORD.encode("utf-8"))
        return user_ok and password_ok

    def _is_local_request(self) -> bool:
        """True only for requests made on this computer, not ones forwarded by Cloudflare."""
        forwarded = any(self.headers.get(name) for name in ("Cf-Connecting-Ip", "X-Forwarded-For", "Cf-Ray"))
        return not forwarded and self.client_address[0] in {"127.0.0.1", "::1", "localhost"}

    def _require_auth(self) -> None:
        self._send_bytes(
            401,
            '{"detail": "需要存取密碼"}'.encode("utf-8"),
            "application/json; charset=utf-8",
            {"WWW-Authenticate": 'Basic realm="Sync-Us", charset="UTF-8"', "Cache-Control": "no-store"},
        )

    # --- request plumbing -----------------------------------------------------------

    def _read_body(self) -> None:
        """Always consume the request body first, so a keep-alive connection stays in sync
        even when we answer early (401, 404, ...)."""
        self._body = b""
        if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
            self.close_connection = True
            raise RequestTooLarge("不支援分段上傳")
        size = int(self.headers.get("Content-Length") or 0)
        if size > MAX_BODY_BYTES:
            self.close_connection = True
            raise RequestTooLarge("上傳的資料太大了")
        if size > 0:
            self._body = self.rfile.read(size)

    def _dispatch(self, handler):
        try:
            self._read_body()
        except (ValueError, RequestTooLarge) as exc:
            self.close_connection = True
            message = str(exc) if isinstance(exc, RequestTooLarge) else "資料格式不正確"
            self.send_json({"detail": message}, 413 if isinstance(exc, RequestTooLarge) else 400)
            return
        self._safely(handler)

    def _safely(self, handler):
        """Malformed paths or bodies get a JSON error instead of a dropped connection."""
        try:
            handler()
        except services.NotFoundError as exc:
            self.send_json(not_found_body(exc), 404)
        except (KeyError, ValueError, TypeError, IndexError) as exc:
            self.send_json({"detail": f"資料格式不正確：{exc}"}, 400)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception:  # noqa: BLE001
            logger.exception("Unhandled error for %s %s", self.command, self.path)
            self.send_json({"detail": "伺服器暫時出了點問題，請稍後再試"}, 500)

    def do_OPTIONS(self):
        self._dispatch(self._handle_options)

    def _handle_options(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Content-Length", "0")
        self.end_headers()

    # --- GET ------------------------------------------------------------------------

    def do_GET(self):
        self._dispatch(self._handle_get)

    def _handle_get(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if not safe_path(path):
            self.send_json({"detail": "Not found"}, 404)
            return
        if path in PUBLIC_FILES or path.startswith(PUBLIC_PREFIXES):
            self.send_static_file(FRONTEND_DIST_DIR, path, cache_control="public, max-age=86400")
            return
        if not self._authorized():
            return self._require_auth()
        query = parse_qs(parsed.query)

        if path in {"/", "/index.html"}:
            index_path = FRONTEND_DIST_DIR / "index.html"
            # index.html is revalidated every time so phones pick up a new version right away.
            self.send_file(index_path if index_path.exists() else INDEX_PATH, "text/html; charset=utf-8")
            return

        if path.startswith("/assets/"):
            # File names contain a content hash, so they can be cached for a year.
            self.send_static_file(FRONTEND_DIST_DIR, path, cache_control="public, max-age=31536000, immutable")
            return

        if path.startswith("/frontend/"):
            self.send_static_file(FRONTEND_DIR, path.removeprefix("/frontend"))
            return

        if path.startswith(PLANNER_PREFIX):
            self._planner("GET", path, query, {})
            return

        routes = {
            "/api/v1/health": lambda: services.health(),
            "/api/v1/bootstrap": lambda: services.bootstrap(
                parse_required_int(query, "user_id"), query.get("today", [None])[0]
            ),
            "/api/v1/version": lambda: {"version": services.data_version(parse_required_int(query, "user_id"))},
            "/api/v1/tasks": lambda: services.list_tasks(
                couple_id=parse_optional_int(query, "couple_id"),
                user_id=parse_optional_int(query, "user_id"),
                view=query.get("view", ["all"])[0],
            ),
            "/api/v1/tasks/completed": lambda: services.list_completed(
                couple_id=parse_optional_int(query, "couple_id"),
                user_id=parse_optional_int(query, "user_id"),
                view=query.get("view", ["all"])[0],
            ),
            "/api/v1/stats": lambda: services.get_stats(
                parse_optional_int(query, "couple_id") or 1,
                user_id=parse_optional_int(query, "user_id"),
            ),
            "/api/v1/stardust": lambda: services.get_stardust(parse_optional_int(query, "couple_id") or 1),
        }

        if path in routes:
            self.call_json(routes[path])
            return

        if path == "/api/v1/users":
            # 完整使用者清單（含 Email）只給本機檢視模式使用，不經由網域公開
            if self._is_local_request():
                self.call_json(services.list_users)
            else:
                self.send_json({"detail": "Not found"}, 404)
            return

        if path.startswith("/api/v1/couple-invites/user/"):
            self.call_json(lambda: services.list_couple_invites_for_user(path_id(path)))
        elif path.startswith("/api/v1/couple-invites/code/"):
            self.call_json(lambda: services.get_couple_invite_by_code(path_text(path)))
        elif path.startswith("/api/v1/users/"):
            self.call_json(lambda: services.get_user(path_id(path)))
        elif path.startswith("/api/v1/couples/") and path.endswith("/manual"):
            couple_id = segment_id(path, 4)
            self.call_json(
                lambda: services.list_manual_entries(
                    couple_id,
                    parse_required_int(query, "user_id"),
                    subject_user_id=parse_optional_int(query, "subject_user_id"),
                    include_pending=query.get("include_pending", ["1"])[0] != "0",
                )
            )
        elif path.startswith("/api/v1/couples/") and path.endswith("/rewards"):
            couple_id = segment_id(path, 4)
            self.call_json(lambda: services.list_rewards(couple_id, parse_required_int(query, "user_id")))
        elif path.startswith("/api/v1/couples/") and path.endswith("/footprints"):
            couple_id = segment_id(path, 4)
            self.call_json(lambda: services.list_footprints(couple_id, parse_required_int(query, "user_id")))
        elif path.startswith("/api/v1/couples/user/"):
            self.call_json(lambda: services.get_user_couple(path_id(path)))
        elif path.startswith("/api/v1/couples/"):
            self.call_json(lambda: services.get_couple(path_id(path)))
        elif path.startswith("/api/v1/tasks/"):
            self.call_json(lambda: services.get_task(path_id(path), parse_optional_int(query, "user_id")))
        else:
            self.send_json({"detail": "Not found"}, 404)

    # --- POST / PUT / DELETE --------------------------------------------------------

    def do_POST(self):
        self._dispatch(self._handle_post)

    def _handle_post(self):
        if not self._authorized():
            return self._require_auth()
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith(PLANNER_PREFIX):
            self._planner("POST", path, parse_qs(parsed.query), self.read_json())
        elif path == "/api/v1/tasks":
            self.call_json(lambda: services.create_task(self.read_json()), 201)
        elif path == "/api/v1/users":
            self.call_json(lambda: services.create_user(self.read_json()), 201)
        elif path == "/api/v1/auth/login":
            self.call_json(lambda: services.login_user(self.read_json()))
        elif path == "/api/v1/couple-invites":
            self.call_json(lambda: services.create_couple_invite(self.read_json()), 201)
        elif path.startswith("/api/v1/couple-invites/") and path.endswith("/accept"):
            body = self.read_json()
            self.call_json(lambda: services.accept_couple_invite(action_text(path), body))
        elif path.startswith("/api/v1/couple-invites/") and path.endswith("/decline"):
            body = self.read_json()
            self.call_json(lambda: services.decline_couple_invite(action_text(path), body))
        elif path.startswith("/api/v1/couples/") and path.endswith("/rewards"):
            body = self.read_json()
            couple_id = segment_id(path, 4)
            self.call_json(lambda: services.redeem_reward(couple_id, body.get("user_id"), body.get("item_key")), 201)
        elif path.startswith("/api/v1/couples/") and path.endswith("/manual/query"):
            body = self.read_json()
            couple_id = segment_id(path, 4)
            self.call_json(lambda: services.query_manual(couple_id, body.get("user_id"), body.get("query", "")))
        elif path.startswith("/api/v1/couples/") and path.endswith("/manual"):
            body = self.read_json()
            couple_id = segment_id(path, 4)
            self.call_json(lambda: services.upsert_manual_entry(couple_id, body.get("user_id"), body), 201)
        elif path.startswith("/api/v1/manual/") and path.endswith("/confirm"):
            body = self.read_json()
            self.call_json(lambda: services.confirm_manual_entry(action_id(path), body.get("user_id")))
        elif path.startswith("/api/v1/tasks/") and path.endswith("/footprint"):
            body = self.read_json()
            self.call_json(lambda: services.save_task_footprint(action_id(path), body.get("user_id"), body))
        elif path.startswith("/api/v1/tasks/") and path.endswith("/complete"):
            body = self.read_json()
            self.call_json(lambda: services.complete_task(action_id(path), body.get("user_id")))
        elif path.startswith("/api/v1/tasks/") and path.endswith("/reopen"):
            body = self.read_json()
            self.call_json(lambda: services.reopen_task(action_id(path), body.get("user_id")))
        elif path.startswith("/api/v1/tasks/") and path.endswith("/restore"):
            body = self.read_json()
            self.call_json(lambda: services.restore_task(action_id(path), body.get("user_id")))
        elif path.startswith("/api/v1/tasks/") and path.endswith("/confirm"):
            body = self.read_json()
            self.call_json(lambda: services.confirm_task(action_id(path), body.get("user_id")))
        else:
            self.send_json({"detail": "Not found"}, 404)

    def do_PUT(self):
        self._dispatch(self._handle_put)

    def _handle_put(self):
        if not self._authorized():
            return self._require_auth()
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path.startswith(PLANNER_PREFIX):
            self._planner("PUT", parsed.path, query, self.read_json())
        elif parsed.path.startswith("/api/v1/tasks/"):
            body = self.read_json()
            user_id = parse_optional_int(query, "user_id") or body.get("user_id")
            self.call_json(lambda: services.update_task(path_id(parsed.path), body, user_id))
        else:
            self.send_json({"detail": "Not found"}, 404)

    def do_DELETE(self):
        self._dispatch(self._handle_delete)

    def _handle_delete(self):
        if not self._authorized():
            return self._require_auth()
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path.startswith(PLANNER_PREFIX):
            self._planner("DELETE", parsed.path, query, {})
        elif parsed.path.startswith("/api/v1/tasks/"):
            self.call_json(
                lambda: services.delete_task(path_id(parsed.path), parse_optional_int(query, "user_id"))
            )
        else:
            self.send_json({"detail": "Not found"}, 404)

    def _planner(self, method: str, path: str, query: dict, body: dict) -> None:
        route = planner_route(method, path, query, body)
        if route is None:
            self.send_json({"detail": "Not found"}, 404)
            return
        callback, status = route
        self.call_json(callback, status)

    # --- responses ------------------------------------------------------------------

    def call_json(self, callback, success_status=200):
        try:
            self.send_json(callback(), success_status)
        except services.NotFoundError as exc:
            self.send_json(not_found_body(exc), 404)
        except services.ConflictError as exc:
            self.send_json({"detail": str(exc)}, 409)
        except services.ValidationError as exc:
            self.send_json({"detail": str(exc)}, 400)
        except (KeyError, ValueError, TypeError) as exc:
            self.send_json({"detail": f"資料格式不正確：{exc}"}, 400)
        except Exception:  # noqa: BLE001 - keep the server alive and answer with JSON
            logger.exception("Unhandled error for %s %s", self.command, self.path)
            self.send_json({"detail": "伺服器暫時出了點問題，請稍後再試"}, 500)

    def read_json(self) -> dict:
        data = json.loads(getattr(self, "_body", b"").decode("utf-8") or "{}")
        if not isinstance(data, dict):
            raise ValueError("JSON 內容需要是物件")
        return data

    def _accepts_gzip(self) -> bool:
        return "gzip" in self.headers.get("Accept-Encoding", "").lower()

    def _send_bytes(self, status, body: bytes, content_type: str, headers=None, compress=None) -> None:
        extra = dict(headers or {})
        if compress is None:
            compress = content_type.startswith(COMPRESSIBLE_TYPES)
        if compress:
            extra["Vary"] = "Accept-Encoding"
            if len(body) >= GZIP_MIN_BYTES and self._accepts_gzip():
                body = gzip.compress(body, compresslevel=6)
                extra["Content-Encoding"] = "gzip"
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in extra.items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self._send_bytes(
            status,
            body,
            "application/json; charset=utf-8",
            {"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"},
        )

    def send_file(self, path, content_type, cache_control="no-cache"):
        try:
            stat = path.stat()
        except OSError:
            self.send_json({"detail": "Not found"}, 404)
            return
        etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        if etag in self.headers.get("If-None-Match", ""):
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", cache_control)
            self.end_headers()
            return
        compressible = content_type.startswith(COMPRESSIBLE_TYPES)
        use_gzip = compressible and self._accepts_gzip() and stat.st_size >= GZIP_MIN_BYTES
        key = (str(path), stat.st_mtime_ns, stat.st_size, use_gzip)
        with _static_lock:
            body = _static_cache.get(key)
        if body is None:
            body = path.read_bytes()
            if use_gzip:
                body = gzip.compress(body, compresslevel=9)
            with _static_lock:
                if len(_static_cache) > 64:
                    _static_cache.clear()
                _static_cache[key] = body
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", cache_control)
        self.send_header("ETag", etag)
        self.send_header("X-Content-Type-Options", "nosniff")
        if compressible:
            self.send_header("Vary", "Accept-Encoding")
        if use_gzip:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_static_file(self, root, request_path: str, cache_control="no-cache"):
        relative_path = request_path.lstrip("/")
        target = (root / relative_path).resolve()
        root = root.resolve()
        if root != target.parent and root not in target.parents or not target.is_file():
            self.send_json({"detail": "Not found"}, 404)
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix in {".css", ".js", ".jsx", ".txt", ".webmanifest"}:
            content_type = f"{content_type}; charset=utf-8"
        self.send_file(target, content_type, cache_control)


def safe_path(path: str) -> bool:
    """Reject dot segments and backslashes (also percent-encoded), e.g. /icons/../index.html."""
    decoded = unquote(path)
    if "\\" in decoded or "\x00" in decoded:
        return False
    return not any(part in {".", ".."} for part in decoded.split("/"))


def not_found_body(exc: Exception) -> dict:
    body = {"detail": str(exc)}
    if isinstance(exc, services.UserNotFoundError):
        body["code"] = "user_not_found"
    return body


def parse_optional_int(query: dict, key: str) -> int | None:
    value = query.get(key, [None])[0]
    return int(value) if value not in (None, "") else None


def parse_required_int(query: dict, key: str) -> int:
    value = parse_optional_int(query, key)
    if value is None:
        raise ValueError(f"{key} is required")
    return value


def path_id(path: str) -> int:
    return int(path.rstrip("/").rsplit("/", 1)[-1])


def action_id(path: str) -> int:
    # /api/v1/tasks/{id}/complete -> {id}
    return int(path.rstrip("/").split("/")[-2])


def action_text(path: str) -> str:
    return path.rstrip("/").split("/")[-2]


def path_text(path: str) -> str:
    return path.rstrip("/").rsplit("/", 1)[-1]


def segment_id(path: str, index: int) -> int:
    return int(path.rstrip("/").split("/")[index])


# --- 雙人週記 routes -------------------------------------------------------------------
# GET and DELETE take user_id in the query string; POST and PUT in the JSON body (the
# query string also works, like PUT /tasks). Owner fields in the body are ignored: notes
# always go to the acting user's own column.


def planner_route(method: str, path: str, query: dict, body: dict):
    """(callback, success status) for a /api/v1/planner/... request, or None if unknown."""
    parts = tuple(path[len(PLANNER_PREFIX):].strip("/").split("/"))
    acting = body.get("user_id")
    if acting in (None, ""):
        acting = parse_optional_int(query, "user_id")

    if method == "GET" and parts == ("week",):
        user_id = parse_required_int(query, "user_id")
        return (lambda: planner.get_week(user_id, query.get("start", [None])[0])), 200
    if method == "POST" and parts == ("items",):
        return (lambda: planner.create_item(acting, body)), 201
    if len(parts) == 2 and parts[0] == "items" and parts[1].isdigit():
        item_id = int(parts[1])
        if method == "PUT":
            return (lambda: planner.update_item(item_id, acting, body)), 200
        if method == "DELETE":
            return (lambda: planner.delete_item(item_id, acting)), 200
    if method == "POST" and len(parts) == 3 and parts[0] == "items" and parts[1].isdigit() and parts[2] == "restore":
        return (lambda: planner.restore_item(int(parts[1]), acting)), 200
    if method == "PUT" and len(parts) == 2 and parts[0] == "availability":
        return (lambda: planner.set_availability(acting, parts[1], body.get("status"))), 200
    if method == "POST" and parts == ("invitations",):
        return (lambda: planner.create_invitation(acting, body)), 201
    if method == "POST" and len(parts) == 3 and parts[0] == "invitations" and parts[1].isdigit():
        actions = {
            "accept": planner.accept_invitation,
            "decline": planner.decline_invitation,
            "withdraw": planner.withdraw_invitation,
        }
        if parts[2] in actions:
            action = actions[parts[2]]
            return (lambda: action(int(parts[1]), acting)), 200
    if method == "POST" and len(parts) == 3 and parts[0] == "shared-items" and parts[1].isdigit() and parts[2] == "cancel":
        return (lambda: planner.cancel_shared_item(int(parts[1]), acting)), 200
    if method == "POST" and parts == ("calendar", "import-preview"):
        return (lambda: planner.preview_import(acting, body)), 200
    if method == "POST" and parts == ("calendar", "import-confirm"):
        return (lambda: planner.confirm_import(acting, body)), 200
    return None


def configure_logging() -> None:
    """Log to the console and to logs/sync_us.log (rotated), so a background
    instance started at logon still leaves a trail when something goes wrong."""
    global _logging_configured
    if _logging_configured:
        return
    _logging_configured = True
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if sys.stdout is not None:  # pythonw.exe has no console
        console = logging.StreamHandler(sys.stdout)
        console.setFormatter(formatter)
        logger.addHandler(console)
    try:
        config.LOG_DIR.mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler(
            config.LOG_DIR / "sync_us.log", maxBytes=1_000_000, backupCount=5, encoding="utf-8"
        )
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    except OSError:
        logger.warning("無法寫入日誌資料夾 %s，只會顯示在視窗裡", config.LOG_DIR)


def run(host: str = "127.0.0.1", port: int = 8000):
    configure_logging()
    init_db()
    # Bind first: if the port is taken, fail before touching backups.
    server = SyncUsServer((host, port), SyncUsRequestHandler)
    try:
        age = latest_backup_age()
        # Integrity check, then a backup on start unless a recent one exists
        # (restarts must not rotate out good copies). Skipped entirely if the check fails.
        run_maintenance_once(force_backup=age is None or age.total_seconds() > 3600)
    except Exception:  # noqa: BLE001
        logger.exception("啟動時的資料庫檢查或備份失敗")
    start_maintenance()
    if not AUTH_ENABLED:
        logger.warning(
            "沒有設定 SYNC_US_USER / SYNC_US_PASS：知道網址的人都能打開 Sync-Us。"
            "可以執行 deploy\\windows\\install_autostart.bat 設定，或在 .env 檔裡加上這兩行。"
        )
    if host not in {"127.0.0.1", "localhost", "::1"}:
        logger.warning("Sync-Us 正在監聽 %s，同一個網路裡的其他裝置也連得到。", host)
    logger.info("Sync-Us %s running at http://%s:%s", config.APP_VERSION, host, port)
    try:
        server.serve_forever()
    finally:
        server.server_close()
