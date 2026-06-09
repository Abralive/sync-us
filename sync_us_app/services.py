from datetime import datetime
import sqlite3

from .database import connect, row_to_dict, utc_now


ALLOWED_TASK_UPDATES = {
    "title",
    "description",
    "due_time",
    "priority_weight",
    "assigned_to_id",
    "is_private",
    "is_completed",
    "reminder_minutes",
    "collaboration_note",
}


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


def health() -> dict:
    return {"ok": True, "time": utc_now()}


def create_user(data: dict) -> dict:
    with connect() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO users (username, email, created_at) VALUES (?, ?, ?)",
                (data["username"], data["email"], utc_now()),
            )
        except sqlite3.IntegrityError as exc:
            raise ConflictError("Email already exists") from exc
        conn.commit()
        return get_user(cur.lastrowid)


def list_users() -> list[dict]:
    with connect() as conn:
        return [row_to_dict(row) for row in conn.execute("SELECT * FROM users ORDER BY id")]


def get_user(user_id: int) -> dict:
    with connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise NotFoundError("User not found")
        return row_to_dict(row)


def create_couple(data: dict) -> dict:
    with connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO couples (partner_a_id, partner_b_id, status, created_at)
            VALUES (?, ?, 'active', ?)
            """,
            (data["partner_a_id"], data["partner_b_id"], utc_now()),
        )
        conn.commit()
        return get_couple(cur.lastrowid)


def get_couple(couple_id: int) -> dict:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT c.*, a.username AS partner_a_name, b.username AS partner_b_name
            FROM couples c
            JOIN users a ON a.id = c.partner_a_id
            JOIN users b ON b.id = c.partner_b_id
            WHERE c.id = ?
            """,
            (couple_id,),
        ).fetchone()
        if not row:
            raise NotFoundError("Couple not found")
        return row_to_dict(row)


def get_user_couple(user_id: int) -> dict:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM couples WHERE partner_a_id = ? OR partner_b_id = ? ORDER BY id DESC LIMIT 1",
            (user_id, user_id),
        ).fetchone()
        if not row:
            raise NotFoundError("Couple not found")
        return row_to_dict(row)


def create_task(data: dict) -> dict:
    now = utc_now()
    with connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO tasks (
                title, description, due_time, priority_weight, couple_id, created_by_id,
                assigned_to_id, is_private, reminder_minutes, collaboration_note, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["title"],
                data.get("description", ""),
                serialize_datetime(data["due_time"]),
                int(data.get("priority_weight", 50)),
                data.get("couple_id", 1),
                data.get("created_by_id", 1),
                data.get("assigned_to_id"),
                int(bool(data.get("is_private", False))),
                int(data.get("reminder_minutes", 60)),
                data.get("collaboration_note", ""),
                now,
                now,
            ),
        )
        task_id = cur.lastrowid
        match_similar_tasks(conn, task_id)
        conn.commit()
        return get_task(task_id)


def list_tasks(couple_id: int | None = None, user_id: int | None = None, view: str = "all") -> list[dict]:
    where = []
    params = []
    if couple_id is not None:
        where.append("t.couple_id = ?")
        params.append(couple_id)
    if view == "shared":
        where.append("t.is_private = 0")
    elif view == "private":
        where.append("t.is_private = 1")
        if user_id is not None:
            where.append("t.created_by_id = ?")
            params.append(user_id)
    elif view == "mine" and user_id is not None:
        where.append("(t.created_by_id = ? OR t.assigned_to_id = ?)")
        params.extend([user_id, user_id])

    clause = f"WHERE {' AND '.join(where)}" if where else ""
    with connect() as conn:
        rows = conn.execute(
            f"{task_select_sql()} {clause} ORDER BY t.is_completed, t.priority_weight DESC, t.due_time",
            params,
        ).fetchall()
        return [normalize_task(row) for row in rows]


def get_task(task_id: int) -> dict:
    with connect() as conn:
        row = conn.execute(f"{task_select_sql()} WHERE t.id = ?", (task_id,)).fetchone()
        if not row:
            raise NotFoundError("Task not found")
        return normalize_task(row)


def update_task(task_id: int, data: dict) -> dict:
    updates = {key: value for key, value in data.items() if key in ALLOWED_TASK_UPDATES}
    if not updates:
        return get_task(task_id)

    assignments = []
    values = []
    for key, value in updates.items():
        if value is None:
            continue
        if key == "due_time":
            value = serialize_datetime(value)
        if key in {"is_private", "is_completed"}:
            value = int(bool(value))
        assignments.append(f"{key} = ?")
        values.append(value)
    if not assignments:
        return get_task(task_id)

    assignments.append("updated_at = ?")
    values.append(utc_now())
    values.append(task_id)

    with connect() as conn:
        cur = conn.execute(f"UPDATE tasks SET {', '.join(assignments)} WHERE id = ?", values)
        if cur.rowcount == 0:
            raise NotFoundError("Task not found")
        match_similar_tasks(conn, task_id)
        conn.commit()
        return get_task(task_id)


def delete_task(task_id: int) -> dict:
    with connect() as conn:
        cur = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        if cur.rowcount == 0:
            raise NotFoundError("Task not found")
        conn.execute("UPDATE tasks SET matched_task_id = NULL WHERE matched_task_id = ?", (task_id,))
        return {"deleted": True}


def get_stats(couple_id: int = 1) -> dict:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN is_private = 0 THEN 1 ELSE 0 END) AS shared,
                ROUND(AVG(priority_weight), 1) AS average_weight
            FROM tasks
            WHERE couple_id = ?
            """,
            (couple_id,),
        ).fetchone()
        stats = row_to_dict(row)
        total = stats["total"] or 0
        completed = stats["completed"] or 0
        stats["completion_rate"] = round((completed / total) * 100, 1) if total else 0
        return stats


def serialize_datetime(value) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def task_select_sql() -> str:
    return """
        SELECT
            t.*,
            creator.username AS created_by_name,
            assignee.username AS assigned_to_name,
            matched.title AS matched_task_title
        FROM tasks t
        LEFT JOIN users creator ON creator.id = t.created_by_id
        LEFT JOIN users assignee ON assignee.id = t.assigned_to_id
        LEFT JOIN tasks matched ON matched.id = t.matched_task_id
    """


def normalize_task(row: sqlite3.Row) -> dict:
    task = row_to_dict(row)
    task["is_private"] = bool(task["is_private"])
    task["is_completed"] = bool(task["is_completed"])
    return task


def tokenize_title(title: str) -> set[str]:
    normalized = title.lower().replace(",", " ").replace("，", " ")
    return {token for token in normalized.split() if len(token) >= 2}


def match_similar_tasks(conn: sqlite3.Connection, task_id: int) -> None:
    task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not task or task["is_private"]:
        return

    tokens = tokenize_title(task["title"])
    if not tokens:
        return

    candidates = conn.execute(
        """
        SELECT id, title
        FROM tasks
        WHERE id != ? AND couple_id = ? AND is_private = 0 AND is_completed = 0
        """,
        (task_id, task["couple_id"]),
    ).fetchall()
    for candidate in candidates:
        if tokens.intersection(tokenize_title(candidate["title"])):
            conn.execute("UPDATE tasks SET matched_task_id = ? WHERE id = ?", (candidate["id"], task_id))
            conn.execute("UPDATE tasks SET matched_task_id = ? WHERE id = ?", (task_id, candidate["id"]))
            return
