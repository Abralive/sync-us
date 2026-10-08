"""Start the Sync-Us server.

    python run_sync_us.py             # normal start (Ctrl+C to stop)
    pythonw run_sync_us.py --service  # background start used by the Windows autostart task:
                                      # if the server stops (for example the port is still
                                      # busy right after logon), it waits and starts again.
    python run_sync_us.py --backup    # write a backup into backups/ now (safe while running)

SYNC_US_HOST defaults to 127.0.0.1, so only this computer (and Cloudflare Tunnel running
on it) can reach the server. Set SYNC_US_HOST=0.0.0.0 to open it to your local network.
"""

import logging
import os
import sys
import time

from sync_us_app.simple_server import configure_logging, run


def main() -> None:
    host = os.environ.get("SYNC_US_HOST", "127.0.0.1")
    port = int(os.environ.get("SYNC_US_PORT", "8051"))
    if "--backup" in sys.argv:
        from sync_us_app.maintenance import backup_database

        target = backup_database()
        print(f"備份完成：{target}" if target else "還沒有資料庫可以備份。")
        return
    if "--service" not in sys.argv:
        run(host=host, port=port)
        return

    configure_logging()
    logger = logging.getLogger("sync_us")
    delay = 5
    while True:
        started = time.monotonic()
        try:
            run(host=host, port=port)
        except KeyboardInterrupt:
            return
        except Exception:  # noqa: BLE001 - log and try again
            logger.exception("Sync-Us 停止了，%s 秒後重新啟動", delay)
        if time.monotonic() - started > 300:
            delay = 5  # it ran fine for a while, so restart quickly
        time.sleep(delay)
        delay = min(delay * 2, 60)


if __name__ == "__main__":
    main()
