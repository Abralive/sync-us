from datetime import datetime, timezone
import os
import sqlite3

from .config import DB_PATH


# Set by init_db() once the database is in WAL mode. WAL keeps readers and the writer from
# blocking each other, and makes synchronous=NORMAL safe (no corruption on power loss).
_WAL_ENABLED = False

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
    "deleted_at": "TEXT",
    "deleted_by_id": "INTEGER",
    "updated_at": "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    "created_at": "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


def utc_now_dt() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def connect() -> sqlite3.Connection:
    # timeout = how long a writer waits for another writer instead of failing with "database is locked"
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    if _WAL_ENABLED:
        conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def row_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


def enable_wal(conn: sqlite3.Connection) -> bool:
    global _WAL_ENABLED
    try:
        mode = conn.execute("PRAGMA journal_mode = WAL").fetchone()[0]
    except sqlite3.DatabaseError:
        mode = ""
    _WAL_ENABLED = str(mode).lower() == "wal"
    return _WAL_ENABLED


def quick_check() -> tuple[bool, str]:
    """Fast structural check of the database file (run at startup)."""
    try:
        with connect() as conn:
            rows = [row[0] for row in conn.execute("PRAGMA quick_check").fetchall()]
    except sqlite3.DatabaseError as exc:
        return False, str(exc)
    if rows == ["ok"]:
        return True, "ok"
    return False, "; ".join(str(item) for item in rows[:5])


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        enable_wal(conn)
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
                ended_at TEXT,
                FOREIGN KEY(partner_a_id) REFERENCES users(id),
                FOREIGN KEY(partner_b_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS couple_invites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                inviter_id INTEGER NOT NULL,
                invitee_email TEXT,
                invite_code TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'pending',
                expires_at TEXT NOT NULL,
                accepted_by_id INTEGER,
                couple_id INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(inviter_id) REFERENCES users(id),
                FOREIGN KEY(accepted_by_id) REFERENCES users(id),
                FOREIGN KEY(couple_id) REFERENCES couples(id)
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

            CREATE TABLE IF NOT EXISTS reward_redemptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                couple_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                item_key TEXT NOT NULL,
                item_title TEXT NOT NULL,
                cost INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(couple_id) REFERENCES couples(id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_rewards_couple
                ON reward_redemptions(couple_id, created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_manual_couple_subject
                ON partner_manual_entries(couple_id, subject_user_id, status);

            CREATE INDEX IF NOT EXISTS idx_footprints_couple_completed
                ON shared_footprints(couple_id, completed_at DESC);

            CREATE INDEX IF NOT EXISTS idx_couple_invites_user_status
                ON couple_invites(inviter_id, invitee_email, status);
            """
        )
        ensure_couple_columns(conn)
        ensure_task_columns(conn)
        # Created after ensure_task_columns: older databases only get some columns there.
        conn.executescript(
            """
            CREATE INDEX IF NOT EXISTS idx_tasks_couple_state
                ON tasks(couple_id, is_completed, due_time);

            CREATE INDEX IF NOT EXISTS idx_tasks_couple_completed
                ON tasks(couple_id, completed_at);

            CREATE INDEX IF NOT EXISTS idx_tasks_matched
                ON tasks(matched_task_id);

            CREATE INDEX IF NOT EXISTS idx_couples_partner_a
                ON couples(partner_a_id, status);

            CREATE INDEX IF NOT EXISTS idx_couples_partner_b
                ON couples(partner_b_id, status);

            -- The change fingerprint (/version) reads MAX(updated_at) every few seconds;
            -- without these, footprint photos (stored inline) make it walk megabytes.
            CREATE INDEX IF NOT EXISTS idx_tasks_couple_updated
                ON tasks(couple_id, updated_at);

            CREATE INDEX IF NOT EXISTS idx_footprints_couple_updated
                ON shared_footprints(couple_id, updated_at);

            CREATE INDEX IF NOT EXISTS idx_manual_couple_updated
                ON partner_manual_entries(couple_id, updated_at);
            """
        )
        ensure_planner_tables(conn)
        if os.environ.get("SYNC_US_SEED", "0") == "1":
            seed_data(conn)


def ensure_planner_tables(conn: sqlite3.Connection) -> None:
    """雙人週記: day notes for each partner, day availability, and meetup invitations.

    Purely additive (new tables only), so existing data is untouched. Dates are calendar
    days stored as "YYYY-MM-DD" with inclusive ranges, never timestamps, so 10/12 stays
    10/12 in every time zone.
    """
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS meetup_invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            couple_id INTEGER NOT NULL,
            from_user_id INTEGER NOT NULL,
            to_user_id INTEGER NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            shared_item_id INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            responded_at TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(couple_id) REFERENCES couples(id),
            FOREIGN KEY(from_user_id) REFERENCES users(id),
            FOREIGN KEY(to_user_id) REFERENCES users(id),
            FOREIGN KEY(shared_item_id) REFERENCES planner_items(id),
            CHECK (from_user_id <> to_user_id),
            CHECK (start_date <= end_date),
            CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'cancelled'))
        );

        -- One row per note. A shared row (owner_user_id NULL) only comes from an accepted
        -- invitation and is drawn once across both columns; it never copies personal rows.
        CREATE TABLE IF NOT EXISTS planner_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            couple_id INTEGER NOT NULL,
            owner_user_id INTEGER,
            scope TEXT NOT NULL DEFAULT 'personal',
            kind TEXT NOT NULL DEFAULT 'event',
            title TEXT NOT NULL,
            details TEXT NOT NULL DEFAULT '',
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            task_done INTEGER,
            source TEXT NOT NULL DEFAULT 'manual',
            external_source_id TEXT,
            visibility TEXT NOT NULL DEFAULT 'full',
            status TEXT NOT NULL DEFAULT 'active',
            invitation_id INTEGER,
            created_by_id INTEGER NOT NULL,
            cancelled_by_id INTEGER,
            cancelled_at TEXT,
            deleted_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(couple_id) REFERENCES couples(id),
            FOREIGN KEY(owner_user_id) REFERENCES users(id),
            FOREIGN KEY(created_by_id) REFERENCES users(id),
            FOREIGN KEY(cancelled_by_id) REFERENCES users(id),
            FOREIGN KEY(invitation_id) REFERENCES meetup_invitations(id),
            CHECK (start_date <= end_date),
            CHECK (scope IN ('personal', 'shared')),
            CHECK ((scope = 'personal') = (owner_user_id IS NOT NULL)),
            CHECK (status IN ('active', 'cancelled'))
        );

        -- No row means "unknown": an empty day is never treated as free.
        CREATE TABLE IF NOT EXISTS planner_day_availability (
            couple_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            status TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (couple_id, user_id, date),
            FOREIGN KEY(couple_id) REFERENCES couples(id),
            FOREIGN KEY(user_id) REFERENCES users(id),
            CHECK (status IN ('available', 'unavailable'))
        );

        -- The week view asks for start_date <= week_end AND end_date >= week_start.
        CREATE INDEX IF NOT EXISTS idx_planner_items_week
            ON planner_items(couple_id, start_date, end_date);

        CREATE INDEX IF NOT EXISTS idx_planner_items_updated
            ON planner_items(couple_id, updated_at);

        -- Accepting the same invitation twice can never create a second shared row.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_items_invitation
            ON planner_items(invitation_id) WHERE invitation_id IS NOT NULL;

        -- Importing the same calendar event again is skipped.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_items_external
            ON planner_items(couple_id, owner_user_id, source, external_source_id)
            WHERE external_source_id IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_planner_availability_date
            ON planner_day_availability(couple_id, date);

        CREATE INDEX IF NOT EXISTS idx_planner_availability_updated
            ON planner_day_availability(couple_id, updated_at);

        -- At most one waiting invitation per couple and date range (double taps, both
        -- partners inviting at once).
        CREATE UNIQUE INDEX IF NOT EXISTS idx_meetup_one_pending
            ON meetup_invitations(couple_id, start_date, end_date) WHERE status = 'pending';

        CREATE INDEX IF NOT EXISTS idx_meetup_couple_status
            ON meetup_invitations(couple_id, status, start_date);

        CREATE INDEX IF NOT EXISTS idx_meetup_couple_updated
            ON meetup_invitations(couple_id, updated_at);
        """
    )


def ensure_couple_columns(conn: sqlite3.Connection) -> None:
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(couples)").fetchall()}
    if "ended_at" not in existing:
        conn.execute("ALTER TABLE couples ADD COLUMN ended_at TEXT")


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
