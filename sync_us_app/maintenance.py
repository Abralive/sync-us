"""Database upkeep: online backups and clean-up of deleted bubbles and weekly notes.

Backups use SQLite's backup API, so they are consistent even while the server is
writing (copying the .db file by hand can miss data that is still in the WAL file).
"""

from datetime import datetime, timedelta
import json
import logging
from pathlib import Path
import sqlite3
import threading
import time

from . import config
from .database import connect, quick_check, utc_now_dt

logger = logging.getLogger("sync_us")

BACKUP_PREFIX = "sync_us-"
# Copies of a database that failed its integrity check never count as rotating backups,
# so they can't push the last good copies out.
SUSPECT_PREFIX = "suspect-sync_us-"
BACKUP_EVERY = timedelta(hours=24)
DELETED_TASK_RETENTION = timedelta(days=7)

_maintenance_started = False
_lock = threading.Lock()


def list_backups(backup_dir: Path | None = None) -> list[Path]:
    folder = Path(backup_dir or config.BACKUP_DIR)
    if not folder.exists():
        return []
    # Names carry a sortable timestamp, newest last.
    return sorted(folder.glob(f"{BACKUP_PREFIX}*.db"), key=lambda path: path.name)


def latest_backup_age(backup_dir: Path | None = None) -> timedelta | None:
    backups = list_backups(backup_dir)
    if not backups:
        return None
    newest = backups[-1].stat().st_mtime
    return timedelta(seconds=max(0.0, time.time() - newest))


def backup_database(backup_dir: Path | None = None, keep: int | None = None, suspect: bool = False) -> Path | None:
    """Write a consistent copy of the database and keep only the newest `keep` copies.

    With suspect=True (the database failed its integrity check) the copy gets a different
    name and nothing is pruned.
    """
    db_path = Path(config.DB_PATH)
    if not db_path.exists() or db_path.stat().st_size == 0:
        return None
    folder = Path(backup_dir or config.BACKUP_DIR)
    folder.mkdir(parents=True, exist_ok=True)
    prefix = SUSPECT_PREFIX if suspect else BACKUP_PREFIX
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = folder / f"{prefix}{stamp}.db"
    counter = 1
    while target.exists():
        counter += 1
        target = folder / f"{prefix}{stamp}-{counter}.db"

    with _lock:
        source = sqlite3.connect(db_path, timeout=10)
        try:
            destination = sqlite3.connect(target)
            try:
                source.backup(destination)
                # Keep each backup a single self-contained file.
                destination.execute("PRAGMA journal_mode = DELETE")
            finally:
                destination.close()
        finally:
            source.close()
    if not suspect:
        prune_backups(folder, keep)
    return target


def prune_backups(backup_dir: Path | None = None, keep: int | None = None) -> int:
    limit = max(1, keep or config.BACKUP_KEEP)
    backups = list_backups(backup_dir)
    removed = 0
    for old in backups[:-limit]:
        try:
            old.unlink()
            removed += 1
        except OSError:
            logger.warning("無法刪除舊備份 %s", old)
    return removed


def purge_deleted_tasks(older_than: timedelta = DELETED_TASK_RETENTION) -> int:
    """Permanently remove bubbles that were deleted (and not restored) long enough ago."""
    cutoff = (utc_now_dt() - older_than).isoformat()
    with connect() as conn:
        # Completed bubbles are never purged: they belong to the shared history and the jar.
        rows = conn.execute(
            "SELECT id FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ? AND is_completed = 0",
            (cutoff,),
        ).fetchall()
        ids = [row["id"] for row in rows]
        for task_id in ids:
            conn.execute("UPDATE tasks SET matched_task_id = NULL WHERE matched_task_id = ?", (task_id,))
            conn.execute("DELETE FROM shared_footprints WHERE bubble_id = ?", (task_id,))
            conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
    return len(ids)


def write_status_file(integrity_ok: bool, detail: str) -> None:
    """logs/status.json lets deploy\\windows\\status.bat show the database state without a password."""
    backups = list_backups()
    status = {
        "checked_at": datetime.now().isoformat(timespec="seconds"),
        "integrity_ok": integrity_ok,
        "integrity_detail": detail,
        "latest_backup": backups[-1].name if backups else None,
        "version": config.APP_VERSION,
    }
    try:
        config.LOG_DIR.mkdir(parents=True, exist_ok=True)
        (config.LOG_DIR / "status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        logger.warning("無法寫入 %s", config.LOG_DIR / "status.json")


def run_maintenance_once(force_backup: bool = False) -> bool:
    """Check the database, then back up and clean up only if it is healthy.

    Returns the integrity result. When the check fails, nothing is backed up, pruned or
    purged, so the existing good backups stay untouched until someone looks at it.
    """
    from . import services  # late import: services imports the database layer too

    ok, detail = quick_check()
    services.INTEGRITY.update({"ok": ok, "detail": detail})
    if not ok:
        logger.error(
            "資料庫完整性檢查沒有通過：%s。已暫停自動備份和清理，backups 資料夾裡的備份都會保留。",
            detail,
        )
        write_status_file(False, detail)
        return False
    age = latest_backup_age()
    if force_backup or age is None or age >= BACKUP_EVERY:
        target = backup_database()
        if target:
            logger.info("資料庫已備份：%s", target.name)
    purged = purge_deleted_tasks()
    if purged:
        logger.info("清除了 %s 顆刪除超過 7 天的泡泡", purged)
    from . import planner  # late import, like services above

    purged_notes = planner.purge_deleted_items()
    if purged_notes:
        logger.info("清除了 %s 筆刪除超過 7 天的週記事項", purged_notes)
    write_status_file(True, detail)
    return True


def start_maintenance(check_every_seconds: int = 3600) -> None:
    """Hourly check in the background; a new backup is made once the newest is a day old."""
    global _maintenance_started
    if _maintenance_started:
        return
    _maintenance_started = True

    def loop() -> None:
        while True:
            time.sleep(check_every_seconds)
            try:
                run_maintenance_once()
            except Exception:  # noqa: BLE001 - upkeep must never stop the server
                logger.exception("資料庫例行維護失敗")

    threading.Thread(target=loop, name="sync-us-maintenance", daemon=True).start()
