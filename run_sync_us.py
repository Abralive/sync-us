import os

from sync_us_app.simple_server import run


if __name__ == "__main__":
    host = os.environ.get("SYNC_US_HOST", "0.0.0.0")
    port = int(os.environ.get("SYNC_US_PORT", "8051"))
    run(host=host, port=port)
