from datetime import datetime, timedelta
import json
import secrets
import sqlite3
import string

from .database import connect, row_to_dict, utc_now, utc_now_dt


ALLOWED_TASK_UPDATES = {
    "title",
    "description",
    "due_time",
    "priority_weight",
    "assigned_to_id",
    "is_private",
    "reminder_minutes",
    "collaboration_note",
}

# --- Stardust (virtual currency) anti-farm config ---
DUST_PER_TASK = 12          # 每顆符合資格的泡泡發放星塵
DAILY_AWARD_CAP = 10        # 每對情侶每日最多計入的泡泡數
DUE_GRACE = timedelta(hours=6)  # 到期前多久內完成也算數（以到期時間為準）


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


class ValidationError(Exception):
    pass


MANUAL_CATEGORIES = {
    "basic": "基本資訊",
    "health": "飲食與健康",
    "likes": "喜好",
    "care": "相處提醒",
    "planning": "規劃偏好",
    "memo": "其他備忘",
}

MANUAL_STATUS = {"pending", "confirmed"}
MANUAL_SOURCE_TYPES = {"manual", "self", "ai_suggestion", "footprint"}
INVITE_CODE_ALPHABET = string.ascii_uppercase + string.digits
INVITE_TTL = timedelta(days=7)


def parse_dt(value) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    text = str(value).strip().replace("Z", "").replace("+00:00", "")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


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
        partner_a = int(data["partner_a_id"])
        partner_b = int(data["partner_b_id"])
        if partner_a == partner_b:
            raise ValidationError("Cannot connect a user to themselves")
        ensure_user_has_no_active_couple(conn, partner_a)
        ensure_user_has_no_active_couple(conn, partner_b)
        cur = conn.execute(
            """
            INSERT INTO couples (partner_a_id, partner_b_id, status, created_at)
            VALUES (?, ?, 'active', ?)
            """,
            (partner_a, partner_b, utc_now()),
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
            """
            SELECT *
            FROM couples
            WHERE status = 'active'
              AND (partner_a_id = ? OR partner_b_id = ?)
            ORDER BY id DESC
            LIMIT 1
            """,
            (user_id, user_id),
        ).fetchone()
        if not row:
            raise NotFoundError("Couple not found")
        return row_to_dict(row)


def ensure_user_has_no_active_couple(conn: sqlite3.Connection, user_id: int) -> None:
    row = conn.execute(
        """
        SELECT id
        FROM couples
        WHERE status = 'active'
          AND (partner_a_id = ? OR partner_b_id = ?)
        LIMIT 1
        """,
        (user_id, user_id),
    ).fetchone()
    if row:
        raise ConflictError("User already has an active Sync-Us connection")


def generate_invite_code(conn: sqlite3.Connection) -> str:
    for _ in range(20):
        code = "SYNC-" + "".join(secrets.choice(INVITE_CODE_ALPHABET) for _ in range(4))
        exists = conn.execute("SELECT id FROM couple_invites WHERE invite_code = ?", (code,)).fetchone()
        if not exists:
            return code
    raise ConflictError("Could not generate invite code")


def normalize_invite(row: sqlite3.Row) -> dict:
    invite = row_to_dict(row)
    expires_at = parse_dt(invite.get("expires_at"))
    if invite["status"] == "pending" and expires_at and expires_at < utc_now_dt():
        invite["status"] = "expired"
    return invite


def create_couple_invite(data: dict) -> dict:
    inviter_id = int(data.get("inviter_id") or data.get("user_id"))
    invitee_email = (data.get("invitee_email") or "").strip().lower() or None
    with connect() as conn:
        inviter = conn.execute("SELECT * FROM users WHERE id = ?", (inviter_id,)).fetchone()
        if not inviter:
            raise NotFoundError("Inviter not found")
        ensure_user_has_no_active_couple(conn, inviter_id)
        existing = conn.execute(
            """
            SELECT *
            FROM couple_invites
            WHERE inviter_id = ? AND status = 'pending' AND expires_at > ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (inviter_id, utc_now()),
        ).fetchone()
        if existing:
            return normalize_invite(existing)

        code = generate_invite_code(conn)
        now = utc_now()
        expires_at = (utc_now_dt() + INVITE_TTL).isoformat()
        cur = conn.execute(
            """
            INSERT INTO couple_invites (
                inviter_id, invitee_email, invite_code, status, expires_at, created_at, updated_at
            )
            VALUES (?, ?, ?, 'pending', ?, ?, ?)
            """,
            (inviter_id, invitee_email, code, expires_at, now, now),
        )
        conn.commit()
        return get_couple_invite(cur.lastrowid)


def get_couple_invite(invite_id: int) -> dict:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT i.*, inviter.username AS inviter_name, inviter.email AS inviter_email,
                   accepter.username AS accepted_by_name
            FROM couple_invites i
            JOIN users inviter ON inviter.id = i.inviter_id
            LEFT JOIN users accepter ON accepter.id = i.accepted_by_id
            WHERE i.id = ?
            """,
            (invite_id,),
        ).fetchone()
        if not row:
            raise NotFoundError("Invite not found")
        invite = normalize_invite(row)
        if invite["status"] == "expired":
            conn.execute(
                "UPDATE couple_invites SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'",
                (utc_now(), invite_id),
            )
            conn.commit()
        return invite


def get_couple_invite_by_code(invite_code: str) -> dict:
    code = (invite_code or "").strip().upper()
    with connect() as conn:
        row = conn.execute(
            """
            SELECT i.*, inviter.username AS inviter_name, inviter.email AS inviter_email,
                   accepter.username AS accepted_by_name
            FROM couple_invites i
            JOIN users inviter ON inviter.id = i.inviter_id
            LEFT JOIN users accepter ON accepter.id = i.accepted_by_id
            WHERE i.invite_code = ?
            """,
            (code,),
        ).fetchone()
        if not row:
            raise NotFoundError("Invite not found")
        invite = normalize_invite(row)
        if invite["status"] == "expired":
            conn.execute(
                "UPDATE couple_invites SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'",
                (utc_now(), invite["id"]),
            )
            conn.commit()
        return invite


def list_couple_invites_for_user(user_id: int) -> dict:
    with connect() as conn:
        user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise NotFoundError("User not found")
        rows = conn.execute(
            """
            SELECT i.*, inviter.username AS inviter_name, inviter.email AS inviter_email,
                   accepter.username AS accepted_by_name
            FROM couple_invites i
            JOIN users inviter ON inviter.id = i.inviter_id
            LEFT JOIN users accepter ON accepter.id = i.accepted_by_id
            WHERE i.inviter_id = ?
               OR lower(i.invitee_email) = lower(?)
            ORDER BY i.id DESC
            """,
            (user_id, user["email"]),
        ).fetchall()
        return {"sent_or_received": [normalize_invite(row) for row in rows]}


def accept_couple_invite(invite_code: str, data: dict) -> dict:
    user_id = int(data.get("user_id") or data.get("accepted_by_id"))
    code = (invite_code or "").strip().upper()
    with connect() as conn:
        user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise NotFoundError("User not found")
        invite = conn.execute(
            "SELECT * FROM couple_invites WHERE invite_code = ?",
            (code,),
        ).fetchone()
        if not invite:
            raise NotFoundError("Invite not found")
        if invite["status"] != "pending":
            raise ConflictError("Invite is not pending")
        expires_at = parse_dt(invite["expires_at"])
        if expires_at and expires_at < utc_now_dt():
            conn.execute(
                "UPDATE couple_invites SET status = 'expired', updated_at = ? WHERE id = ?",
                (utc_now(), invite["id"]),
            )
            conn.commit()
            raise ConflictError("Invite expired")
        if invite["inviter_id"] == user_id:
            raise ValidationError("Invite must be accepted by the other person")
        if invite["invitee_email"] and invite["invitee_email"].lower() != user["email"].lower():
            raise ValidationError("This invite is for a different email")
        ensure_user_has_no_active_couple(conn, invite["inviter_id"])
        ensure_user_has_no_active_couple(conn, user_id)
        now = utc_now()
        cur = conn.execute(
            """
            INSERT INTO couples (partner_a_id, partner_b_id, status, created_at)
            VALUES (?, ?, 'active', ?)
            """,
            (invite["inviter_id"], user_id, now),
        )
        couple_id = cur.lastrowid
        conn.execute(
            """
            UPDATE couple_invites
            SET status = 'accepted', accepted_by_id = ?, couple_id = ?, updated_at = ?
            WHERE id = ?
            """,
            (user_id, couple_id, now, invite["id"]),
        )
        conn.commit()
        return get_couple(couple_id)


def decline_couple_invite(invite_code: str, data: dict) -> dict:
    user_id = int(data.get("user_id"))
    code = (invite_code or "").strip().upper()
    with connect() as conn:
        user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        invite = conn.execute("SELECT * FROM couple_invites WHERE invite_code = ?", (code,)).fetchone()
        if not user or not invite:
            raise NotFoundError("Invite not found")
        if invite["status"] != "pending":
            raise ConflictError("Invite is not pending")
        if invite["inviter_id"] != user_id and (
            not invite["invitee_email"] or invite["invitee_email"].lower() != user["email"].lower()
        ):
            raise ValidationError("User cannot decline this invite")
        now = utc_now()
        conn.execute(
            "UPDATE couple_invites SET status = 'declined', updated_at = ? WHERE id = ?",
            (now, invite["id"]),
        )
        conn.commit()
        return get_couple_invite_by_code(code)


def ensure_couple_member(conn: sqlite3.Connection, couple_id: int, user_id: int | None) -> sqlite3.Row:
    if user_id is None:
        raise ValidationError("Missing user_id")
    row = conn.execute(
        """
        SELECT c.*, a.username AS partner_a_name, b.username AS partner_b_name
        FROM couples c
        JOIN users a ON a.id = c.partner_a_id
        JOIN users b ON b.id = c.partner_b_id
        WHERE c.id = ?
          AND c.status = 'active'
          AND (c.partner_a_id = ? OR c.partner_b_id = ?)
        """,
        (couple_id, user_id, user_id),
    ).fetchone()
    if not row:
        raise ValidationError("使用者沒有這組連結的存取權")
    return row


def ensure_task_member(conn: sqlite3.Connection, task: sqlite3.Row, user_id: int | None) -> sqlite3.Row:
    return ensure_couple_member(conn, task["couple_id"], user_id or task["created_by_id"])


def partner_user_id(couple: sqlite3.Row, user_id: int) -> int:
    return couple["partner_b_id"] if couple["partner_a_id"] == user_id else couple["partner_a_id"]


def normalize_manual_entry(row: sqlite3.Row) -> dict:
    entry = row_to_dict(row)
    entry["category_name"] = MANUAL_CATEGORIES.get(entry["category"], entry["category"])
    entry["status_label"] = "已確認" if entry["status"] == "confirmed" else "待確認"
    return entry


def list_manual_entries(
    couple_id: int,
    user_id: int,
    subject_user_id: int | None = None,
    include_pending: bool = True,
) -> dict:
    with connect() as conn:
        couple = ensure_couple_member(conn, couple_id, user_id)
        subject = subject_user_id or partner_user_id(couple, user_id)
        if subject not in {couple["partner_a_id"], couple["partner_b_id"]}:
            raise ValidationError("手冊對象不屬於這組連結")
        status_clause = "" if include_pending else "AND m.status = 'confirmed'"
        rows = conn.execute(
            f"""
            SELECT m.*, subject.username AS subject_name, creator.username AS created_by_name
            FROM partner_manual_entries m
            JOIN users subject ON subject.id = m.subject_user_id
            JOIN users creator ON creator.id = m.created_by_id
            WHERE m.couple_id = ? AND m.subject_user_id = ? {status_clause}
            ORDER BY
              CASE m.category
                WHEN 'basic' THEN 1
                WHEN 'health' THEN 2
                WHEN 'likes' THEN 3
                WHEN 'care' THEN 4
                WHEN 'planning' THEN 5
                ELSE 6
              END,
              m.updated_at DESC
            """,
            (couple_id, subject),
        ).fetchall()
        return {
            "subject_user_id": subject,
            "entries": [normalize_manual_entry(row) for row in rows],
            "categories": MANUAL_CATEGORIES,
        }


def upsert_manual_entry(couple_id: int, user_id: int, data: dict) -> dict:
    category = data.get("category")
    if category not in MANUAL_CATEGORIES:
        raise ValidationError("Unknown manual category")
    label = str(data.get("label", "")).strip()
    value = str(data.get("value", "")).strip()
    if not label or not value:
        raise ValidationError("手冊資料需要標籤與內容")
    if len(label) > 40 or len(value) > 160:
        raise ValidationError("手冊資料太長，請縮短後再儲存")
    source_type = data.get("source_type", "manual")
    if source_type not in MANUAL_SOURCE_TYPES:
        raise ValidationError("Unknown source_type")
    status = data.get("status") or ("pending" if source_type == "ai_suggestion" else "confirmed")
    if status not in MANUAL_STATUS:
        raise ValidationError("Unknown manual status")

    now = utc_now()
    with connect() as conn:
        couple = ensure_couple_member(conn, couple_id, user_id)
        subject = int(data.get("subject_user_id") or partner_user_id(couple, user_id))
        if subject not in {couple["partner_a_id"], couple["partner_b_id"]}:
            raise ValidationError("手冊對象不屬於這組連結")
        conn.execute(
            """
            INSERT INTO partner_manual_entries (
                couple_id, subject_user_id, category, label, value, source_type,
                source_label, status, created_by_id, updated_by_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(couple_id, subject_user_id, category, label)
            DO UPDATE SET
                value = excluded.value,
                source_type = excluded.source_type,
                source_label = excluded.source_label,
                status = excluded.status,
                updated_by_id = excluded.updated_by_id,
                updated_at = excluded.updated_at
            """,
            (
                couple_id,
                subject,
                category,
                label,
                value,
                source_type,
                data.get("source_label") or "共同手冊",
                status,
                user_id,
                user_id,
                now,
                now,
            ),
        )
        conn.commit()
        return list_manual_entries(couple_id, user_id, subject)


def confirm_manual_entry(entry_id: int, user_id: int) -> dict:
    now = utc_now()
    with connect() as conn:
        entry = conn.execute("SELECT * FROM partner_manual_entries WHERE id = ?", (entry_id,)).fetchone()
        if not entry:
            raise NotFoundError("Manual entry not found")
        ensure_couple_member(conn, entry["couple_id"], user_id)
        conn.execute(
            "UPDATE partner_manual_entries SET status = 'confirmed', updated_by_id = ?, updated_at = ? WHERE id = ?",
            (user_id, now, entry_id),
        )
        conn.commit()
        return list_manual_entries(entry["couple_id"], user_id, entry["subject_user_id"])


def query_manual(couple_id: int, user_id: int, query: str) -> dict:
    keyword = str(query or "").strip()
    if not keyword:
        raise ValidationError("請輸入想查詢的資料")
    with connect() as conn:
        couple = ensure_couple_member(conn, couple_id, user_id)
        subject = partner_user_id(couple, user_id)
        rows = conn.execute(
            """
            SELECT m.*, subject.username AS subject_name
            FROM partner_manual_entries m
            JOIN users subject ON subject.id = m.subject_user_id
            WHERE m.couple_id = ?
              AND m.subject_user_id = ?
              AND m.status = 'confirmed'
            ORDER BY m.updated_at DESC
            """,
            (couple_id, subject),
        ).fetchall()

    tokens = [part for part in keyword.lower().replace("？", " ").replace("?", " ").split() if part]
    category_hints = []
    if any(word in keyword for word in ["過敏", "不能吃", "健康", "飲食", "花生"]):
        category_hints.append("health")
    if any(word in keyword for word in ["喜歡", "禮物", "活動", "節日", "食物"]):
        category_hints.append("likes")
    if any(word in keyword for word in ["生日", "日期", "紀念"]):
        category_hints.append("basic")
    if any(word in keyword for word in ["提醒", "行程", "安排"]):
        category_hints.append("planning")

    matches = []
    for row in rows:
        haystack = f"{row['category']} {row['label']} {row['value']}".lower()
        has_text_match = any(token and token in haystack for token in tokens)
        has_category_match = row["category"] in category_hints
        if has_text_match or has_category_match:
            matches.append(row)

    if not matches:
        return {
            "answer": "目前沒有記錄",
            "sources": [],
            "updated_at": None,
            "safety": "只根據已確認的共同手冊資料回答，沒有資料時不推測。",
        }

    sources = [
        {
            "label": row["label"],
            "source": row["source_label"] or "共同手冊",
            "updated_at": row["updated_at"],
        }
        for row in matches[:3]
    ]
    answer = "；".join(f"{row['label']}：{row['value']}" for row in matches[:3])
    return {
        "answer": answer,
        "sources": sources,
        "updated_at": sources[0]["updated_at"] if sources else None,
        "safety": "只根據已確認的共同手冊資料回答。",
    }


def create_task(data: dict) -> dict:
    due = parse_dt(data.get("due_time"))
    if due is None:
        raise ValidationError("請設定到期時間")
    if due <= utc_now_dt():
        raise ValidationError("到期時間必須是未來時間（避免回填刷星塵）")
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

    # 進行中清單不顯示已完成（已完成的歸入「完成回顧」）
    where.append("t.is_completed = 0")

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


def footprint_participants(conn: sqlite3.Connection, task: sqlite3.Row) -> list[dict]:
    couple = conn.execute(
        """
        SELECT c.*, a.username AS partner_a_name, b.username AS partner_b_name
        FROM couples c
        JOIN users a ON a.id = c.partner_a_id
        JOIN users b ON b.id = c.partner_b_id
        WHERE c.id = ?
        """,
        (task["couple_id"],),
    ).fetchone()
    people = []
    if couple:
        people.append({"id": couple["partner_a_id"], "name": couple["partner_a_name"]})
        people.append({"id": couple["partner_b_id"], "name": couple["partner_b_name"]})
    else:
        creator = conn.execute("SELECT username FROM users WHERE id = ?", (task["created_by_id"],)).fetchone()
        people.append({"id": task["created_by_id"], "name": creator["username"] if creator else "Sync"})
    if task["assigned_to_id"] and not any(person["id"] == task["assigned_to_id"] for person in people):
        assignee = conn.execute("SELECT username FROM users WHERE id = ?", (task["assigned_to_id"],)).fetchone()
        people.append({"id": task["assigned_to_id"], "name": assignee["username"] if assignee else "Sync"})
    return people


def create_or_update_footprint_for_task(
    conn: sqlite3.Connection,
    task_id: int,
    user_id: int,
    note: str | None = None,
    photo_data_url: str | None = None,
) -> dict | None:
    task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not task:
        raise NotFoundError("Task not found")
    ensure_task_member(conn, task, user_id)
    if task["is_private"]:
        return None
    if not task["is_completed"]:
        raise ConflictError("泡泡尚未完成，不能建立共同足跡")

    normalized_note = str(note or "").strip()
    if len(normalized_note) > 80:
        raise ValidationError("紀錄文字最多 80 字")
    normalized_photo = str(photo_data_url or "").strip()
    if normalized_photo and not normalized_photo.startswith("data:image/"):
        raise ValidationError("照片格式需要是圖片資料")
    if len(normalized_photo) > 1_500_000:
        raise ValidationError("照片太大，請換一張較小的圖片")

    now = utc_now()
    selected = conn.execute(f"{task_select_sql()} WHERE t.id = ?", (task_id,)).fetchone()
    original_task = normalize_task(selected) if selected else row_to_dict(task)
    existing = conn.execute("SELECT * FROM shared_footprints WHERE bubble_id = ?", (task_id,)).fetchone()
    if existing:
        updates = ["updated_by_id = ?", "updated_at = ?"]
        params: list = [user_id, now]
        if note is not None:
            updates.append("note = ?")
            params.append(normalized_note or None)
        if photo_data_url is not None:
            updates.append("photo_data_url = ?")
            params.append(normalized_photo or None)
        params.append(existing["id"])
        conn.execute(f"UPDATE shared_footprints SET {', '.join(updates)} WHERE id = ?", params)
        return get_footprint_by_id(conn, existing["id"])

    completed_at = task["completed_at"] or now
    cur = conn.execute(
        """
        INSERT INTO shared_footprints (
            couple_id, bubble_id, task_title, completed_at, participants,
            photo_data_url, note, created_by_id, updated_by_id, created_at, updated_at, original_task_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            task["couple_id"],
            task_id,
            task["title"],
            completed_at,
            json.dumps(footprint_participants(conn, task), ensure_ascii=False),
            normalized_photo or None,
            normalized_note or None,
            user_id,
            user_id,
            now,
            now,
            json.dumps(original_task, ensure_ascii=False, default=str),
        ),
    )
    return get_footprint_by_id(conn, cur.lastrowid)


def normalize_footprint(row: sqlite3.Row) -> dict:
    item = row_to_dict(row)
    try:
        item["participants"] = json.loads(item.get("participants") or "[]")
    except json.JSONDecodeError:
        item["participants"] = []
    try:
        item["original_task"] = json.loads(item.get("original_task_json") or "{}")
    except json.JSONDecodeError:
        item["original_task"] = {}
    item.pop("original_task_json", None)
    return item


def get_footprint_by_id(conn: sqlite3.Connection, footprint_id: int) -> dict:
    row = conn.execute(
        """
        SELECT f.*, creator.username AS created_by_name, updater.username AS updated_by_name
        FROM shared_footprints f
        JOIN users creator ON creator.id = f.created_by_id
        LEFT JOIN users updater ON updater.id = f.updated_by_id
        WHERE f.id = ?
        """,
        (footprint_id,),
    ).fetchone()
    if not row:
        raise NotFoundError("Footprint not found")
    return normalize_footprint(row)


def list_footprints(couple_id: int, user_id: int) -> list[dict]:
    with connect() as conn:
        ensure_couple_member(conn, couple_id, user_id)
        rows = conn.execute(
            """
            SELECT f.*, creator.username AS created_by_name, updater.username AS updated_by_name
            FROM shared_footprints f
            JOIN users creator ON creator.id = f.created_by_id
            LEFT JOIN users updater ON updater.id = f.updated_by_id
            WHERE f.couple_id = ?
            ORDER BY f.completed_at DESC, f.id DESC
            """,
            (couple_id,),
        ).fetchall()
        return [normalize_footprint(row) for row in rows]


def save_task_footprint(task_id: int, user_id: int, data: dict) -> dict:
    with connect() as conn:
        footprint = create_or_update_footprint_for_task(
            conn,
            task_id,
            user_id,
            note=data.get("note") if "note" in data else None,
            photo_data_url=data.get("photo_data_url") if "photo_data_url" in data else None,
        )
        conn.commit()
        if footprint is None:
            return {"skipped": True, "reason": "私人泡泡不會進入共同足跡"}
        return footprint


def complete_task(task_id: int, user_id: int | None = None) -> dict:
    now = utc_now()
    with connect() as conn:
        task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            raise NotFoundError("Task not found")
        actor = user_id or task["created_by_id"]
        ensure_task_member(conn, task, actor)
        if task["is_completed"]:
            if not task["is_private"]:
                create_or_update_footprint_for_task(conn, task_id, actor)
                conn.commit()
            return get_task(task_id)

        is_private = bool(task["is_private"])
        conn.execute(
            """
            UPDATE tasks
            SET is_completed = 1,
                completed_at = ?,
                completed_by_id = ?,
                confirmed = ?,
                confirmed_at = ?,
                confirmed_by_id = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                now,
                actor,
                1,
                now,
                actor,
                now,
                task_id,
            ),
        )
        _evaluate_award(conn, task_id)
        if not is_private:
            create_or_update_footprint_for_task(conn, task_id, actor)
        conn.commit()
        return get_task(task_id)


def confirm_task(task_id: int, user_id: int | None = None) -> dict:
    now = utc_now()
    with connect() as conn:
        task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            raise NotFoundError("Task not found")
        actor = user_id or task["created_by_id"]
        ensure_task_member(conn, task, actor)
        if not task["is_completed"]:
            raise ConflictError("還沒戳破，無法確認")
        if task["confirmed"]:
            raise ConflictError("這顆泡泡已經確認過了")
        if user_id is not None and task["completed_by_id"] == user_id:
            raise ValidationError("共享泡泡需由伴侶確認，不能自己確認")

        conn.execute(
            "UPDATE tasks SET confirmed = 1, confirmed_at = ?, confirmed_by_id = ?, updated_at = ? WHERE id = ?",
            (now, user_id, now, task_id),
        )
        _evaluate_award(conn, task_id)
        conn.commit()
        return get_task(task_id)


def _awarded_today(conn: sqlite3.Connection, couple_id, on_date: str) -> int:
    row = conn.execute(
        """
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE couple_id = ? AND stardust_awarded > 0 AND substr(confirmed_at, 1, 10) = ?
        """,
        (couple_id, on_date),
    ).fetchone()
    return row["count"] if row else 0


def _evaluate_award(conn: sqlite3.Connection, task_id: int) -> None:
    """符合資格才發星塵：已完成且已確認、達到期資格、未超過每日上限、每顆只發一次。"""
    task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not task or task["stardust_awarded"] > 0:
        return
    if not (task["is_completed"] and task["confirmed"]):
        return

    completed = parse_dt(task["completed_at"])
    due = parse_dt(task["due_time"])
    if completed is None or due is None:
        return
    # 以到期時間為準：完成時間需達「到期前緩衝」之後才算數
    if completed < due - DUE_GRACE:
        return

    award_date = (parse_dt(task["confirmed_at"]) or completed).date().isoformat()
    if _awarded_today(conn, task["couple_id"], award_date) >= DAILY_AWARD_CAP:
        return

    conn.execute("UPDATE tasks SET stardust_awarded = ? WHERE id = ?", (DUST_PER_TASK, task_id))


def list_completed(couple_id: int | None = None, user_id: int | None = None, view: str = "all") -> list[dict]:
    where = ["t.is_completed = 1"]
    params: list = []
    if couple_id is not None:
        where.append("t.couple_id = ?")
        params.append(couple_id)
    if view == "shared":
        where.append("t.is_private = 0")
    elif view == "private":
        where.append("t.is_private = 1")
    if user_id is not None and view == "mine":
        where.append("(t.completed_by_id = ? OR t.created_by_id = ?)")
        params.extend([user_id, user_id])

    clause = f"WHERE {' AND '.join(where)}"
    with connect() as conn:
        rows = conn.execute(
            f"{task_select_sql()} {clause} ORDER BY t.completed_at DESC",
            params,
        ).fetchall()
        return [normalize_task(row) for row in rows]


def get_stardust(couple_id: int = 1) -> dict:
    with connect() as conn:
        total = conn.execute(
            "SELECT COALESCE(SUM(stardust_awarded), 0) AS dust FROM tasks WHERE couple_id = ?",
            (couple_id,),
        ).fetchone()["dust"]
        pending = conn.execute(
            "SELECT COUNT(*) AS count FROM tasks WHERE couple_id = ? AND is_completed = 1 AND confirmed = 0",
            (couple_id,),
        ).fetchone()["count"]
        today = utc_now_dt().date().isoformat()
        return {
            "stardust": total,
            "pending_confirm": pending,
            "awarded_today": _awarded_today(conn, couple_id, today),
            "daily_cap": DAILY_AWARD_CAP,
            "dust_per_task": DUST_PER_TASK,
        }


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
    dust = get_stardust(couple_id)
    stats["stardust"] = dust["stardust"]
    stats["pending_confirm"] = dust["pending_confirm"]
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
            completer.username AS completed_by_name,
            confirmer.username AS confirmed_by_name,
            matched.title AS matched_task_title
        FROM tasks t
        LEFT JOIN users creator ON creator.id = t.created_by_id
        LEFT JOIN users assignee ON assignee.id = t.assigned_to_id
        LEFT JOIN users completer ON completer.id = t.completed_by_id
        LEFT JOIN users confirmer ON confirmer.id = t.confirmed_by_id
        LEFT JOIN tasks matched ON matched.id = t.matched_task_id
    """


def normalize_task(row: sqlite3.Row) -> dict:
    task = row_to_dict(row)
    task["is_private"] = bool(task["is_private"])
    task["is_completed"] = bool(task["is_completed"])
    task["confirmed"] = bool(task.get("confirmed", 0))
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
