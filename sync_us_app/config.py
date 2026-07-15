import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent

# Optional HTTP Basic Auth for public tunnels.
# Set both SYNC_US_USER and SYNC_US_PASS in the environment to enable it.
AUTH_USER = os.environ.get("SYNC_US_USER", "")
AUTH_PASSWORD = os.environ.get("SYNC_US_PASS", "")
AUTH_ENABLED = bool(AUTH_USER and AUTH_PASSWORD)

DB_PATH = BASE_DIR / "sync_us.db"
INDEX_PATH = BASE_DIR / "index.html"
FRONTEND_DIR = BASE_DIR / "frontend"
FRONTEND_DIST_DIR = FRONTEND_DIR / "dist"
API_PREFIX = "/api/v1"
