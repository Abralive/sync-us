import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
APP_VERSION = "2026.10.09"


def _load_env_file(path: Path) -> None:
    """Read SYNC_US_* settings from a local .env file (never committed).

    Real environment variables win, so a .bat file or the shell can still override them.
    """
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError:
        return
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key.startswith("SYNC_US_") and key not in os.environ:
            os.environ[key] = value


_load_env_file(BASE_DIR / ".env")

# Optional HTTP Basic Auth for public tunnels.
# Set both SYNC_US_USER and SYNC_US_PASS (in the environment or in .env) to enable it.
AUTH_USER = os.environ.get("SYNC_US_USER", "")
AUTH_PASSWORD = os.environ.get("SYNC_US_PASS", "")
AUTH_ENABLED = bool(AUTH_USER and AUTH_PASSWORD)

DB_PATH = Path(os.environ.get("SYNC_US_DB", BASE_DIR / "sync_us.db"))
BACKUP_DIR = Path(os.environ.get("SYNC_US_BACKUP_DIR", BASE_DIR / "backups"))
BACKUP_KEEP = max(1, int(os.environ.get("SYNC_US_BACKUP_KEEP", "14")))
LOG_DIR = Path(os.environ.get("SYNC_US_LOG_DIR", BASE_DIR / "logs"))
INDEX_PATH = BASE_DIR / "index.html"
FRONTEND_DIR = BASE_DIR / "frontend"
FRONTEND_DIST_DIR = FRONTEND_DIR / "dist"
API_PREFIX = "/api/v1"
