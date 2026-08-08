from datetime import datetime, timezone
import os
import sqlite3

from .config import DB_PATH


TASK_COLUMNS = {
    "description": "TEXT NOT NULL DEFAULT ''",
    "couple_id": "INTEGER",
    "created_by_id": "INTEGER NOT NULL DEFAULT 1",
    "assigned_to_id": "INTEGER",
    "is_private": "INTEGER NOT NULL DEFAULT 0",
    "is_completed": "INTEGER NOT NULL DEFAULT 0",
    "reminder_minutes": "INTEGER NOT NULL DEFAULT 60",
    "collaboration_note": "TEXT NOT NULL DEFAULT ''",
    "matched_task_id": "INTEGER",
    "completed_at": "TEXT",
    "completed_by_id": "INTEGER",
    "confirmed": "INTEGER NOT NULL DEFAULT 0",
    "confirmed_at": "TEXT",
    "confirmed_by_id": "INTEGER",
    "stardust_awarded": "INTEGER NOT NULL DEFAULT 0",
    "updated_at": "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    "created_at": "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


def utc_now_dt() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def row_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS couples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                partner_a_id INTEGER NOT NULL,
                partner_b_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(partner_a_id) REFERENCES users(id),
                FOREIGN KEY(partner_b_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                due_time TEXT NOT NULL,
                priority_weight INTEGER NOT NULL DEFAULT 50,
                couple_id INTEGER,
                created_by_id INTEGER NOT NULL DEFAULT 1,
                assigned_to_id INTEGER,
                is_private INTEGER NOT NULL DEFAULT 0,
                is_completed INTEGER NOT NULL DEFAULT 0,
                reminder_minutes INTEGER NOT NULL DEFAULT 60,
                collaboration_note TEXT NOT NULL DEFAULT '',
                matched_task_id INTEGER,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(couple_id) REFERENCES couples(id),
                FOREIGN KEY(created_by_id) REFERENCES users(id),
                FOREIGN KEY(assigned_to_id) REFERENCES users(id),
                FOREIGN KEY(matched_task_id) REFERENCES tasks(id)
            );

            CREATE TABLE IF NOT EXISTS partner_manual_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                couple_id INTEGER NOT NULL,
                subject_user_id INTEGER NOT NULL,
                category TEXT NOT NULL,
                label TEXT NOT NULL,
                value TEXT NOT NULL,
                source_type TEXT NOT NULL DEFAULT 'manual',
                source_label TEXT NOT NULL DEFAULT '共同手冊',
                status TEXT NOT NULL DEFAULT 'confirmed',
                created_by_id INTEGER NOT NULL,
                updated_by_id INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(couple_id) REFERENCES couples(id),
                FOREIGN KEY(subject_user_id) REFERENCES users(id),
                FOREIGN KEY(created_by_id) REFERENCES users(id),
                FOREIGN KEY(updated_by_id) REFERENCES users(id),
                UNIQUE(couple_id, subject_user_id, category, label)
            );

            CREATE TABLE IF NOT EXISTS shared_footprints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                couple_id INTEGER NOT NULL,
                bubble_id INTEGER NOT NULL UNIQUE,
                task_title TEXT NOT NULL,
                completed_at TEXT NOT NULL,
                participants TEXT NOT NULL DEFAULT '[]',
                photo_data_url TEXT,
                note TEXT,
                created_by_id INTEGER NOT NULL,
                updated_by_id INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                original_task_json TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY(couple_id) REFERENCES couples(id),
                FOREIGN KEY(bubble_id) REFERENCES tasks(id),
                FOREIGN KEY(created_by_id) REFERENCES users(id),
                FOREIGN KEY(updated_by_id) REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_manual_couple_subject
                ON partner_manual_entries(couple_id, subject_user_id, status);

            CREATE INDEX IF NOT EXISTS idx_footprints_couple_completed
                ON shared_footprints(couple_id, completed_at DESC);
            """
        )
        ensure_task_columns(conn)
        if os.environ.get("SYNC_US_SEED", "0") == "1":
            seed_data(conn)


def ensure_task_columns(conn: sqlite3.Connection) -> None:
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()}
    for name, ddl in TASK_COLUMNS.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE tasks ADD COLUMN {name} {ddl}")


def seed_data(conn: sqlite3.Connection) -> None:
    user_count = conn.execute("SELECT COUNT(*) AS count FROM users").fetchone()["count"]
    if user_count:
        return

    now = utc_now()
    conn.execute(
        "INSERT INTO users (username, email, created_at) VALUES (?, ?, ?)",
        ("Mina", "mina@sync-us.local", now),
    )
    conn.execute(
        "INSERT INTO users (username, email, created_at) VALUES (?, ?, ?)",
        ("Kai", "kai@sync-us.local", now),
    )
    conn.execute(
        "INSERT INTO couples (partner_a_id, partner_b_id, status, created_at) VALUES (1, 2, 'active', ?)",
        (now,),
    )
    tasks = [
        ("訂週末晚餐", "確認餐廳與時間", "2026-06-08T19:00:00", 78, 1, 1, 2, 0, 45),
        ("準備簡報", "今晚需要安靜完成大綱", "2026-06-06T22:00:00", 92, 1, 1, 1, 1, 30),
        ("一起整理旅行清單", "分工確認證件、住宿與交通", "2026-06-10T20:00:00", 66, 1, 2, None, 0, 120),
    ]
    conn.executemany(
        """
        INSERT INTO tasks (
            title, description, due_time, priority_weight, couple_id, created_by_id,
            assigned_to_id, is_private, reminder_minutes, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [(*task, now, now) for task in tasks],
    )
