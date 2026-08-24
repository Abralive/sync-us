from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import base64
import json
import mimetypes

from . import services
from .config import AUTH_ENABLED, AUTH_PASSWORD, AUTH_USER, FRONTEND_DIR, FRONTEND_DIST_DIR, INDEX_PATH
from .database import init_db


class SyncUsRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

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
        return user == AUTH_USER and password == AUTH_PASSWORD

    def _require_auth(self) -> None:
        body = '{"detail": "需要存取密碼"}'.encode("utf-8")
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Sync-Us"')
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        if not self._authorized():
            return self._require_auth()
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)

        if parsed.path == "/":
            index_path = FRONTEND_DIST_DIR / "index.html"
            self.send_file(index_path if index_path.exists() else INDEX_PATH, "text/html; charset=utf-8")
            return

        if parsed.path.startswith("/assets/"):
            self.send_static_file(FRONTEND_DIST_DIR, parsed.path)
            return

        if parsed.path.startswith("/frontend/"):
            self.send_static_file(FRONTEND_DIR, parsed.path.removeprefix("/frontend"))
            return

        routes = {
            "/api/v1/health": lambda: services.health(),
            "/api/v1/users": lambda: services.list_users(),
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
            "/api/v1/stats": lambda: services.get_stats(parse_optional_int(query, "couple_id") or 1),
            "/api/v1/stardust": lambda: services.get_stardust(parse_optional_int(query, "couple_id") or 1),
        }

        if parsed.path in routes:
            self.call_json(routes[parsed.path])
            return

        if parsed.path.startswith("/api/v1/couple-invites/user/"):
            self.call_json(lambda: services.list_couple_invites_for_user(path_id(parsed.path)))
        elif parsed.path.startswith("/api/v1/couple-invites/code/"):
            self.call_json(lambda: services.get_couple_invite_by_code(path_text(parsed.path)))
        elif parsed.path.startswith("/api/v1/users/"):
            self.call_json(lambda: services.get_user(path_id(parsed.path)))
        elif parsed.path.startswith("/api/v1/couples/") and parsed.path.endswith("/manual"):
            couple_id = segment_id(parsed.path, 4)
            self.call_json(
                lambda: services.list_manual_entries(
                    couple_id,
                    parse_required_int(query, "user_id"),
                    subject_user_id=parse_optional_int(query, "subject_user_id"),
                    include_pending=query.get("include_pending", ["1"])[0] != "0",
                )
            )
        elif parsed.path.startswith("/api/v1/couples/") and parsed.path.endswith("/footprints"):
            couple_id = segment_id(parsed.path, 4)
            self.call_json(lambda: services.list_footprints(couple_id, parse_required_int(query, "user_id")))
        elif parsed.path.startswith("/api/v1/couples/user/"):
            self.call_json(lambda: services.get_user_couple(path_id(parsed.path)))
        elif parsed.path.startswith("/api/v1/couples/"):
            self.call_json(lambda: services.get_couple(path_id(parsed.path)))
        elif parsed.path.startswith("/api/v1/tasks/"):
            self.call_json(lambda: services.get_task(path_id(parsed.path)))
        else:
            self.send_json({"detail": "Not found"}, 404)

    def do_POST(self):
        if not self._authorized():
            return self._require_auth()
        parsed = urlparse(self.path)
        if parsed.path == "/api/v1/tasks":
            self.call_json(lambda: services.create_task(self.read_json()), 201)
        elif parsed.path == "/api/v1/users":
            self.call_json(lambda: services.create_user(self.read_json()), 201)
        elif parsed.path == "/api/v1/couples":
            self.call_json(lambda: services.create_couple(self.read_json()), 201)
        elif parsed.path == "/api/v1/couple-invites":
            self.call_json(lambda: services.create_couple_invite(self.read_json()), 201)
        elif parsed.path.startswith("/api/v1/couple-invites/") and parsed.path.endswith("/accept"):
            body = self.read_json()
            self.call_json(lambda: services.accept_couple_invite(action_text(parsed.path), body))
        elif parsed.path.startswith("/api/v1/couple-invites/") and parsed.path.endswith("/decline"):
            body = self.read_json()
            self.call_json(lambda: services.decline_couple_invite(action_text(parsed.path), body))
        elif parsed.path.startswith("/api/v1/couples/") and parsed.path.endswith("/manual/query"):
            body = self.read_json()
            couple_id = segment_id(parsed.path, 4)
            self.call_json(lambda: services.query_manual(couple_id, body.get("user_id"), body.get("query", "")))
        elif parsed.path.startswith("/api/v1/couples/") and parsed.path.endswith("/manual"):
            body = self.read_json()
            couple_id = segment_id(parsed.path, 4)
            self.call_json(lambda: services.upsert_manual_entry(couple_id, body.get("user_id"), body), 201)
        elif parsed.path.startswith("/api/v1/manual/") and parsed.path.endswith("/confirm"):
            body = self.read_json()
            self.call_json(lambda: services.confirm_manual_entry(action_id(parsed.path), body.get("user_id")))
        elif parsed.path.startswith("/api/v1/tasks/") and parsed.path.endswith("/footprint"):
            body = self.read_json()
            self.call_json(lambda: services.save_task_footprint(action_id(parsed.path), body.get("user_id"), body))
        elif parsed.path.startswith("/api/v1/tasks/") and parsed.path.endswith("/complete"):
            body = self.read_json()
            self.call_json(lambda: services.complete_task(action_id(parsed.path), body.get("user_id")))
        elif parsed.path.startswith("/api/v1/tasks/") and parsed.path.endswith("/confirm"):
            body = self.read_json()
            self.call_json(lambda: services.confirm_task(action_id(parsed.path), body.get("user_id")))
        else:
            self.send_json({"detail": "Not found"}, 404)

    def do_PUT(self):
        if not self._authorized():
            return self._require_auth()
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/v1/tasks/"):
            self.call_json(lambda: services.update_task(path_id(parsed.path), self.read_json()))
        else:
            self.send_json({"detail": "Not found"}, 404)

    def do_DELETE(self):
        if not self._authorized():
            return self._require_auth()
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/v1/tasks/"):
            self.call_json(lambda: services.delete_task(path_id(parsed.path)))
        else:
            self.send_json({"detail": "Not found"}, 404)

    def call_json(self, callback, success_status=200):
        try:
            self.send_json(callback(), success_status)
        except services.NotFoundError as exc:
            self.send_json({"detail": str(exc)}, 404)
        except services.ConflictError as exc:
            self.send_json({"detail": str(exc)}, 409)
        except services.ValidationError as exc:
            self.send_json({"detail": str(exc)}, 400)
        except (KeyError, ValueError, TypeError) as exc:
            self.send_json({"detail": f"Invalid request: {exc}"}, 400)

    def read_json(self) -> dict:
        size = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(size).decode("utf-8") or "{}")

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, content_type):
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_static_file(self, root, request_path: str):
        relative_path = request_path.lstrip("/")
        target = (root / relative_path).resolve()
        root = root.resolve()
        if root != target.parent and root not in target.parents or not target.is_file():
            self.send_json({"detail": "Not found"}, 404)
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix in {".css", ".js", ".jsx"}:
            content_type = f"{content_type}; charset=utf-8"
        self.send_file(target, content_type)


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


def run(host: str = "127.0.0.1", port: int = 8000):
    init_db()
    server = ThreadingHTTPServer((host, port), SyncUsRequestHandler)
    print(f"Sync-Us running at http://{host}:{port}")
    server.serve_forever()
