from datetime import datetime, timedelta
import hashlib
import json
import re
import secrets
import sqlite3
import string

from .config import APP_VERSION
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


class UserNotFoundError(NotFoundError):
    """The account itself is gone (e.g. database reset): clients should sign out."""


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
REWARD_ITEMS = {
    "coffee": {"title": "雙人咖啡券", "cost": 80, "copy": "完成共享泡泡後，換一個不用吵架的補給。"},
    "dinner": {"title": "晚餐許願卡", "cost": 140, "copy": "把共同完成的努力，換成一次被認真安排的晚餐。"},
    "weekend": {"title": "週末空白時段", "cost": 220, "copy": "保留一段不被打擾、也不被雜事插隊的共同時間。"},
}
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
TITLE_MAX = 60
DESCRIPTION_MAX = 200
# Undo windows: a completed bubble can be reopened by whoever completed it for a short
# while; a deleted bubble stays restorable for a day and is purged after a week.
REOPEN_WINDOW = timedelta(minutes=15)
RESTORE_WINDOW = timedelta(hours=24)

# Startup integrity result, reported by /health.
INTEGRITY = {"ok": True, "detail": "not checked"}


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
    database = "ok"
    try:
        with connect() as conn:
            conn.execute("SELECT 1").fetchone()
    except sqlite3.Error:
        database = "error"
    if database == "ok" and not INTEGRITY["ok"]:
        database = "integrity-problem"
    return {"ok": database == "ok", "time": utc_now(), "database": database, "version": APP_VERSION}


def normalize_email(value) -> str:
    return str(value or "").strip().lower()


def create_user(data: dict) -> dict:
    username = str(data.get("username") or "").strip()
    email = normalize_email(data.get("email"))
    if not username:
        raise ValidationError("請先替你的小星球取一個名字。")
    if len(username) > 30:
        raise ValidationError("名字最多 30 個字。")
    if not EMAIL_PATTERN.match(email):
        raise ValidationError("Email 格式看起來不太對，請再確認一次。")
    with connect() as conn:
        exists = conn.execute("SELECT id FROM users WHERE lower(email) = ?", (email,)).fetchone()
        if exists:
            raise ConflictError("這個 Email 已經註冊過了，請直接登入。")
        try:
            cur = conn.execute(
                "INSERT INTO users (username, email, created_at) VALUES (?, ?, ?)",
                (username, email, utc_now()),
            )
        except sqlite3.IntegrityError as exc:
            raise ConflictError("這個 Email 已經註冊過了，請直接登入。") from exc
        conn.commit()
        return get_user(cur.lastrowid)


def login_user(data: dict) -> dict:
    email = normalize_email(data.get("email"))
    if not email:
        raise ValidationError("請輸入註冊時使用的 Email。")
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE lower(email) = ? ORDER BY id LIMIT 1",
            (email,),
        ).fetchone()
    if not row:
        raise NotFoundError("找不到這個 Email，請先註冊或換一個帳號。")
    return row_to_dict(row)


def list_users() -> list[dict]:
    with connect() as conn:
        return [row_to_dict(row) for row in conn.execute("SELECT * FROM users ORDER BY id")]


def get_user(user_id: int) -> dict:
    with connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise UserNotFoundError("找不到這個使用者")
        return row_to_dict(row)


def create_couple(data: dict) -> dict:
    with connect() as conn:
        partner_a = int(data["partner_a_id"])
        partner_b = int(data["partner_b_id"])
        if partner_a == partner_b:
            raise ValidationError("不能和自己建立連結")
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
            raise NotFoundError("還沒有建立連結")
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
            raise NotFoundError("還沒有建立連結")
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
        raise ConflictError("其中一方已經有 Sync-Us 連結了")


def generate_invite_code(conn: sqlite3.Connection) -> str:
    for _ in range(20):
        code = "SYNC-" + "".join(secrets.choice(INVITE_CODE_ALPHABET) for _ in range(4))
        exists = conn.execute("SELECT id FROM couple_invites WHERE invite_code = ?", (code,)).fetchone()
        if not exists:
            return code
    raise ConflictError("暫時無法產生邀請碼，請再試一次")


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
            raise NotFoundError("找不到邀請人")
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
            raise NotFoundError("找不到這個邀請碼")
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
            raise NotFoundError("找不到這個邀請碼")
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
            raise NotFoundError("找不到這個使用者")
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
            raise NotFoundError("找不到這個使用者")
        invite = conn.execute(
            "SELECT * FROM couple_invites WHERE invite_code = ?",
            (code,),
        ).fetchone()
        if not invite:
            raise NotFoundError("找不到這個邀請碼")
        if invite["status"] != "pending":
            raise ConflictError("這個邀請碼已經用過或被取消了")
        expires_at = parse_dt(invite["expires_at"])
        if expires_at and expires_at < utc_now_dt():
            conn.execute(
                "UPDATE couple_invites SET status = 'expired', updated_at = ? WHERE id = ?",
                (utc_now(), invite["id"]),
            )
            conn.commit()
            raise ConflictError("這個邀請碼已過期，請對方重新產生")
        if invite["inviter_id"] == user_id:
            raise ValidationError("邀請碼要由對方輸入，不能自己接受")
        if invite["invitee_email"] and invite["invitee_email"].lower() != user["email"].lower():
            raise ValidationError("這個邀請碼是給另一個 Email 的")
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
            raise NotFoundError("找不到這個邀請碼")
        if invite["status"] != "pending":
            raise ConflictError("這個邀請碼已經用過或被取消了")
        if invite["inviter_id"] != user_id and (
            not invite["invitee_email"] or invite["invitee_email"].lower() != user["email"].lower()
        ):
            raise ValidationError("你不能處理這個邀請")
        now = utc_now()
        conn.execute(
            "UPDATE couple_invites SET status = 'declined', updated_at = ? WHERE id = ?",
            (now, invite["id"]),
        )
        conn.commit()
        return get_couple_invite_by_code(code)


def ensure_couple_member(conn: sqlite3.Connection, couple_id: int, user_id: int | None) -> sqlite3.Row:
    if user_id is None:
        raise ValidationError("缺少使用者資料，請重新登入")
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


def ensure_task_visible(task, user_id: int | None) -> None:
    """Private bubbles belong to their creator only (a missing user_id is never the owner)."""
    if task["is_private"] and (user_id is None or task["created_by_id"] != int(user_id)):
        raise NotFoundError("找不到這顆泡泡")


def visible_task_clause(user_id: int | None) -> tuple[str, list]:
    """SQL filter so a partner never receives the other person's private bubbles."""
    if user_id is None:
        return "t.is_private = 0", []
    return "(t.is_private = 0 OR t.created_by_id = ?)", [user_id]


def fetch_task_row(conn: sqlite3.Connection, task_id: int, include_deleted: bool = False) -> sqlite3.Row:
    """Raw task row; deleted bubbles behave as missing unless asked for (restore)."""
    task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not task or (task["deleted_at"] and not include_deleted):
        raise NotFoundError("找不到這顆泡泡")
    return task


def require_user(user_id) -> int:
    if user_id in (None, ""):
        raise ValidationError("缺少使用者資料，請重新登入")
    return int(user_id)


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
        raise ValidationError("未知的手冊分類")
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
            raise NotFoundError("找不到這筆手冊資料")
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
    title = str(data.get("title") or "").strip()
    if not title:
        raise ValidationError("請填寫泡泡名稱")
    if len(title) > TITLE_MAX:
        raise ValidationError(f"泡泡名稱最多 {TITLE_MAX} 個字")
    due = parse_dt(data.get("due_time"))
    if due is None:
        raise ValidationError("請設定到期時間")
    if due <= utc_now_dt():
        raise ValidationError("到期時間必須是未來時間（避免回填刷星塵）")
    couple_id = int(data.get("couple_id") or 1)
    created_by = int(data.get("created_by_id") or 1)
    is_private = bool(data.get("is_private", False))
    assigned = data.get("assigned_to_id")
    assigned = int(assigned) if assigned not in (None, "") else None
    priority = max(1, min(100, int(data.get("priority_weight", 50))))
    reminder = max(0, int(data.get("reminder_minutes", 60)))
    description = str(data.get("description") or "").strip()
    if len(description) > DESCRIPTION_MAX:
        raise ValidationError(f"備註最多 {DESCRIPTION_MAX} 個字")
    now = utc_now()
    with connect() as conn:
        couple = ensure_couple_member(conn, couple_id, created_by)
        members = {couple["partner_a_id"], couple["partner_b_id"]}
        if assigned is not None and assigned not in members:
            raise ValidationError("泡泡只能交給你們兩人之一")
        if is_private:
            # 私人泡泡只屬於建立者自己
            assigned = created_by
        cur = conn.execute(
            """
            INSERT INTO tasks (
                title, description, due_time, priority_weight, couple_id, created_by_id,
                assigned_to_id, is_private, reminder_minutes, collaboration_note, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                title,
                description,
                serialize_datetime(data["due_time"]),
                priority,
                couple_id,
                created_by,
                assigned,
                int(is_private),
                reminder,
                str(data.get("collaboration_note") or "").strip(),
                now,
                now,
            ),
        )
        task_id = cur.lastrowid
        match_similar_tasks(conn, task_id)
        conn.commit()
        return _load_task(task_id)


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

    # 對方的私人泡泡永遠不會出現在你的清單裡
    privacy_clause, privacy_params = visible_task_clause(user_id)
    where.append(privacy_clause)
    params.extend(privacy_params)

    # 進行中清單不顯示已完成（已完成的歸入「完成回顧」）與已刪除的泡泡
    where.append("t.is_completed = 0")
    where.append("t.deleted_at IS NULL")

    clause = f"WHERE {' AND '.join(where)}" if where else ""
    with connect() as conn:
        rows = conn.execute(
            f"{task_select_sql()} {clause} ORDER BY t.is_completed, t.priority_weight DESC, t.due_time",
            params,
        ).fetchall()
        return [normalize_task(row) for row in rows]


def _load_task(task_id: int, include_deleted: bool = False) -> dict:
    with connect() as conn:
        row = conn.execute(f"{task_select_sql()} WHERE t.id = ?", (task_id,)).fetchone()
        if not row or (row["deleted_at"] and not include_deleted):
            raise NotFoundError("找不到這顆泡泡")
        return normalize_task(row)


def get_task(task_id: int, user_id: int | None = None) -> dict:
    task = _load_task(task_id)
    ensure_task_visible(task, user_id)
    return task


def update_task(task_id: int, data: dict, user_id: int | None = None) -> dict:
    """Edit a bubble. Any partner may edit a shared bubble; only its creator may change privacy."""
    user_id = require_user(user_id)
    # assigned_to_id may be sent as null on purpose: "一起照顧" (nobody in particular).
    updates = {
        key: value
        for key, value in data.items()
        if key in ALLOWED_TASK_UPDATES and (value is not None or key == "assigned_to_id")
    }
    with connect() as conn:
        task = fetch_task_row(conn, task_id)
        ensure_task_member(conn, task, user_id)
        ensure_task_visible(task, user_id)
        if task["is_completed"]:
            raise ConflictError("已完成的泡泡會留在紀錄裡，不能再修改")
        if not updates:
            return _load_task(task_id)

        if "title" in updates:
            updates["title"] = str(updates["title"]).strip()
            if not updates["title"] or len(updates["title"]) > TITLE_MAX:
                raise ValidationError(f"泡泡名稱需要 1–{TITLE_MAX} 個字")
        if "description" in updates:
            updates["description"] = str(updates["description"]).strip()
            if len(updates["description"]) > DESCRIPTION_MAX:
                raise ValidationError(f"備註最多 {DESCRIPTION_MAX} 個字")
        if "collaboration_note" in updates:
            updates["collaboration_note"] = str(updates["collaboration_note"]).strip()[:DESCRIPTION_MAX]
        if "due_time" in updates:
            due = parse_dt(updates["due_time"])
            if due is None:
                raise ValidationError("請設定正確的到期時間")
            if due != parse_dt(task["due_time"]) and due <= utc_now_dt():
                raise ValidationError("到期時間必須是未來時間")
            updates["due_time"] = serialize_datetime(updates["due_time"])
        if "priority_weight" in updates:
            updates["priority_weight"] = max(1, min(100, int(updates["priority_weight"])))
        if "reminder_minutes" in updates:
            updates["reminder_minutes"] = max(0, int(updates["reminder_minutes"]))
        if "is_private" in updates:
            updates["is_private"] = int(bool(updates["is_private"]))
            if updates["is_private"] != task["is_private"] and user_id != task["created_by_id"]:
                raise ValidationError("只有建立泡泡的人可以改變私人設定")
        becomes_private = bool(updates.get("is_private", task["is_private"]))
        if "assigned_to_id" in updates:
            assigned = updates["assigned_to_id"]
            if assigned in (None, ""):
                updates["assigned_to_id"] = None
            else:
                couple = conn.execute("SELECT * FROM couples WHERE id = ?", (task["couple_id"],)).fetchone()
                members = {couple["partner_a_id"], couple["partner_b_id"]} if couple else {task["created_by_id"]}
                if int(assigned) not in members:
                    raise ValidationError("泡泡只能交給你們兩人之一")
                updates["assigned_to_id"] = int(assigned)
        if becomes_private:
            # 私人泡泡只屬於建立者，也不能再和對方的泡泡配對
            updates["assigned_to_id"] = task["created_by_id"]

        assignments = [f"{key} = ?" for key in updates]
        values = list(updates.values())
        assignments.append("updated_at = ?")
        values.extend([utc_now(), task_id])
        cur = conn.execute(
            f"UPDATE tasks SET {', '.join(assignments)} WHERE id = ? AND is_completed = 0 AND deleted_at IS NULL",
            values,
        )
        if cur.rowcount != 1:
            conn.rollback()
            current = fetch_task_row(conn, task_id)
            if current["is_completed"]:
                raise ConflictError("這顆泡泡剛剛被完成了，不能再修改")
            raise ConflictError("這顆泡泡剛剛被修改了，請再試一次")
        renamed = "title" in updates and updates["title"] != task["title"]
        if becomes_private or renamed:
            # 私人泡泡不配對；改名後舊的「同一件事」配對可能已經不成立
            conn.execute("UPDATE tasks SET matched_task_id = NULL WHERE matched_task_id = ? OR id = ?", (task_id, task_id))
        if not becomes_private:
            match_similar_tasks(conn, task_id)
        conn.commit()
        return _load_task(task_id)


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
    task = fetch_task_row(conn, task_id)
    ensure_task_member(conn, task, user_id)
    ensure_task_visible(task, user_id)
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
        raise NotFoundError("找不到這則足跡")
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
        task = fetch_task_row(conn, task_id)
        ensure_task_visible(task, user_id)
        actor = user_id or task["created_by_id"]
        ensure_task_member(conn, task, actor)
        if task["is_completed"]:
            if not task["is_private"]:
                create_or_update_footprint_for_task(conn, task_id, actor)
                conn.commit()
            return _load_task(task_id)

        is_private = bool(task["is_private"])
        cur = conn.execute(
            """
            UPDATE tasks
            SET is_completed = 1,
                completed_at = ?,
                completed_by_id = ?,
                confirmed = ?,
                confirmed_at = ?,
                confirmed_by_id = ?,
                updated_at = ?
            WHERE id = ? AND is_completed = 0 AND deleted_at IS NULL
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
        if cur.rowcount != 1:
            # Changed between the read and the write: deleted (missing) or already completed.
            conn.rollback()
            current = fetch_task_row(conn, task_id)
            if current["is_completed"]:
                return _load_task(task_id)
            raise ConflictError("這顆泡泡剛剛被修改了，請再試一次")
        _evaluate_award(conn, task_id)
        if not is_private:
            create_or_update_footprint_for_task(conn, task_id, actor)
        conn.commit()
        return _load_task(task_id)


def confirm_task(task_id: int, user_id: int | None = None) -> dict:
    now = utc_now()
    with connect() as conn:
        task = fetch_task_row(conn, task_id)
        ensure_task_visible(task, user_id)
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
        return _load_task(task_id)


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
    where = ["t.is_completed = 1", "t.deleted_at IS NULL"]
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
    privacy_clause, privacy_params = visible_task_clause(user_id)
    where.append(privacy_clause)
    params.extend(privacy_params)

    clause = f"WHERE {' AND '.join(where)}"
    with connect() as conn:
        rows = conn.execute(
            f"{task_select_sql()} {clause} ORDER BY t.completed_at DESC",
            params,
        ).fetchall()
        return [normalize_task(row) for row in rows]


def _stardust_balance(conn: sqlite3.Connection, couple_id) -> tuple[int, int]:
    earned = conn.execute(
        "SELECT COALESCE(SUM(stardust_awarded), 0) AS dust FROM tasks WHERE couple_id = ?",
        (couple_id,),
    ).fetchone()["dust"]
    spent = conn.execute(
        "SELECT COALESCE(SUM(cost), 0) AS spent FROM reward_redemptions WHERE couple_id = ?",
        (couple_id,),
    ).fetchone()["spent"]
    return earned, spent


def get_stardust(couple_id: int = 1) -> dict:
    with connect() as conn:
        earned, spent = _stardust_balance(conn, couple_id)
        total = earned - spent
        pending = conn.execute(
            "SELECT COUNT(*) AS count FROM tasks WHERE couple_id = ? AND is_completed = 1 AND confirmed = 0",
            (couple_id,),
        ).fetchone()["count"]
        today = utc_now_dt().date().isoformat()
        return {
            "stardust": total,
            "earned": earned,
            "spent": spent,
            "pending_confirm": pending,
            "awarded_today": _awarded_today(conn, couple_id, today),
            "daily_cap": DAILY_AWARD_CAP,
            "dust_per_task": DUST_PER_TASK,
        }


def list_rewards(couple_id: int, user_id: int) -> dict:
    with connect() as conn:
        ensure_couple_member(conn, couple_id, user_id)
        earned, spent = _stardust_balance(conn, couple_id)
        rows = conn.execute(
            """
            SELECT r.*, u.username AS user_name
            FROM reward_redemptions r
            JOIN users u ON u.id = r.user_id
            WHERE r.couple_id = ?
            ORDER BY r.created_at DESC, r.id DESC
            """,
            (couple_id,),
        ).fetchall()
    return {
        "balance": earned - spent,
        "earned": earned,
        "spent": spent,
        "items": [{"key": key, **item} for key, item in REWARD_ITEMS.items()],
        "redemptions": [row_to_dict(row) for row in rows],
    }


def redeem_reward(couple_id: int, user_id: int, item_key: str) -> dict:
    item = REWARD_ITEMS.get(str(item_key or ""))
    if not item:
        raise ValidationError("找不到這個獎勵")
    with connect() as conn:
        ensure_couple_member(conn, couple_id, user_id)
        # 檢查餘額與寫入放在同一個 SQL 指令裡，兩人同時兌換也不會透支
        cur = conn.execute(
            """
            INSERT INTO reward_redemptions (couple_id, user_id, item_key, item_title, cost, created_at)
            SELECT ?, ?, ?, ?, ?, ?
            WHERE (SELECT COALESCE(SUM(stardust_awarded), 0) FROM tasks WHERE couple_id = ?)
                - (SELECT COALESCE(SUM(cost), 0) FROM reward_redemptions WHERE couple_id = ?) >= ?
            """,
            (couple_id, user_id, item_key, item["title"], item["cost"], utc_now(), couple_id, couple_id, item["cost"]),
        )
        if cur.rowcount != 1:
            raise ConflictError("星塵還不夠，再一起完成幾顆泡泡吧")
        conn.commit()
    return list_rewards(couple_id, user_id)


def delete_task(task_id: int, user_id: int | None = None) -> dict:
    """Soft delete: the bubble disappears for both partners but can be restored for a day."""
    user_id = require_user(user_id)
    with connect() as conn:
        task = fetch_task_row(conn, task_id)
        ensure_task_member(conn, task, user_id)
        ensure_task_visible(task, user_id)
        if task["is_completed"]:
            raise ConflictError("已完成的泡泡會留在共同紀錄裡，不能刪除")
        now = utc_now()
        cur = conn.execute(
            """
            UPDATE tasks
            SET deleted_at = ?, deleted_by_id = ?, matched_task_id = NULL, updated_at = ?
            WHERE id = ? AND is_completed = 0 AND deleted_at IS NULL
            """,
            (now, user_id, now, task_id),
        )
        if cur.rowcount != 1:
            # Completed or deleted by the partner a moment ago.
            conn.rollback()
            current = fetch_task_row(conn, task_id)
            if current["is_completed"]:
                raise ConflictError("這顆泡泡剛剛被完成了，會留在共同紀錄裡，不能刪除")
            raise ConflictError("這顆泡泡剛剛被修改了，請再試一次")
        # 解除配對，另一顆泡泡不會再指向一顆看不到的泡泡
        conn.execute("UPDATE tasks SET matched_task_id = NULL WHERE matched_task_id = ?", (task_id,))
        conn.commit()
        return {"deleted": True, "id": task_id}


def restore_task(task_id: int, user_id: int | None = None) -> dict:
    """Undo a delete (used by the toast's 「復原」 button)."""
    user_id = require_user(user_id)
    with connect() as conn:
        task = fetch_task_row(conn, task_id, include_deleted=True)
        ensure_task_member(conn, task, user_id)
        ensure_task_visible(task, user_id)
        if not task["deleted_at"]:
            return _load_task(task_id)
        deleted_at = parse_dt(task["deleted_at"])
        if deleted_at is None or utc_now_dt() - deleted_at > RESTORE_WINDOW:
            raise ConflictError("刪除超過一天，已經無法復原")
        conn.execute(
            "UPDATE tasks SET deleted_at = NULL, deleted_by_id = NULL, updated_at = ? WHERE id = ?",
            (utc_now(), task_id),
        )
        match_similar_tasks(conn, task_id)
        conn.commit()
        return _load_task(task_id)


def reopen_task(task_id: int, user_id: int | None = None) -> dict:
    """Undo a completion shortly after it happened (an accidental long press, for example).

    Takes back the stardust it earned and the shared footprint it created. Refused once the
    stardust has already been spent, so the jar can never go negative.
    """
    user_id = require_user(user_id)
    with connect() as conn:
        task = fetch_task_row(conn, task_id)
        ensure_task_member(conn, task, user_id)
        ensure_task_visible(task, user_id)
        if not task["is_completed"]:
            return _load_task(task_id)
        if task["completed_by_id"] != user_id:
            raise ValidationError("只有完成這顆泡泡的人可以復原")
        completed_at = parse_dt(task["completed_at"])
        if completed_at is None or utc_now_dt() - completed_at > REOPEN_WINDOW:
            raise ConflictError("完成超過 15 分鐘，已經無法復原")
        dust = int(task["stardust_awarded"] or 0)
        now = utc_now()
        # 餘額檢查和更新在同一個指令裡，和兌換同時發生也不會讓星塵變成負的
        cur = conn.execute(
            """
            UPDATE tasks
            SET is_completed = 0, completed_at = NULL, completed_by_id = NULL,
                confirmed = 0, confirmed_at = NULL, confirmed_by_id = NULL,
                stardust_awarded = 0, updated_at = ?
            WHERE id = ? AND is_completed = 1 AND deleted_at IS NULL
              AND (SELECT COALESCE(SUM(stardust_awarded), 0) FROM tasks WHERE couple_id = ?) - ?
                  >= (SELECT COALESCE(SUM(cost), 0) FROM reward_redemptions WHERE couple_id = ?)
            """,
            (now, task_id, task["couple_id"], dust, task["couple_id"]),
        )
        if cur.rowcount != 1:
            raise ConflictError("這顆泡泡換來的星塵已經用掉了，無法復原")
        conn.execute("DELETE FROM shared_footprints WHERE bubble_id = ?", (task_id,))
        conn.commit()
        return _load_task(task_id)


def get_stats(couple_id: int = 1, user_id: int | None = None) -> dict:
    visibility = ""
    params: list = [couple_id]
    if user_id is not None:
        visibility = "AND (is_private = 0 OR created_by_id = ?)"
        params.append(user_id)
    with connect() as conn:
        row = conn.execute(
            f"""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN is_private = 0 THEN 1 ELSE 0 END) AS shared,
                ROUND(AVG(priority_weight), 1) AS average_weight
            FROM tasks
            WHERE couple_id = ? AND deleted_at IS NULL {visibility}
            """,
            params,
        ).fetchone()
        stats = row_to_dict(row)
        # 只回傳私人泡泡的「數量」，讓對方知道你在忙，但看不到內容
        private_rows = conn.execute(
            """
            SELECT created_by_id, COUNT(*) AS count
            FROM tasks
            WHERE couple_id = ? AND is_private = 1 AND is_completed = 0 AND deleted_at IS NULL
            GROUP BY created_by_id
            """,
            (couple_id,),
        ).fetchall()
        stats["private_active"] = {str(item["created_by_id"]): item["count"] for item in private_rows}
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
    if not task or task["is_private"] or task["deleted_at"]:
        return

    tokens = tokenize_title(task["title"])
    if not tokens:
        return

    candidates = conn.execute(
        """
        SELECT id, title
        FROM tasks
        WHERE id != ? AND couple_id = ? AND is_private = 0 AND is_completed = 0 AND deleted_at IS NULL
        ORDER BY (matched_task_id IS NOT NULL), id
        """,
        (task_id, task["couple_id"]),
    ).fetchall()
    if task["matched_task_id"]:
        return  # already paired; renames clear the pair before calling this
    for candidate in candidates:
        if tokens.intersection(tokenize_title(candidate["title"])):
            # A bubble belongs to at most one pair: drop any older pair either side was in.
            conn.execute(
                "UPDATE tasks SET matched_task_id = NULL WHERE matched_task_id IN (?, ?)",
                (task_id, candidate["id"]),
            )
            conn.execute("UPDATE tasks SET matched_task_id = ? WHERE id = ?", (candidate["id"], task_id))
            conn.execute("UPDATE tasks SET matched_task_id = ? WHERE id = ?", (task_id, candidate["id"]))
            return


# --- One-request start-up and cheap change detection ---------------------------------


def _active_couple_id(conn: sqlite3.Connection, user_id: int) -> int | None:
    row = conn.execute(
        """
        SELECT id FROM couples
        WHERE status = 'active' AND (partner_a_id = ? OR partner_b_id = ?)
        ORDER BY id DESC
        LIMIT 1
        """,
        (user_id, user_id),
    ).fetchone()
    return row["id"] if row else None


def data_version(user_id: int) -> str:
    """A short fingerprint of everything this user's screens show.

    It changes whenever a bubble, handbook entry, footprint, redemption, invite or weekly
    note (notes, day status, meetup invitations) changes, so clients can poll it every few
    seconds and only reload when something happened.
    """
    user_id = int(user_id)
    with connect() as conn:
        user = conn.execute("SELECT id, username, email FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise UserNotFoundError("找不到這個使用者")
        parts = [f"user:{user['username']}"]
        couple_id = _active_couple_id(conn, user_id)
        if couple_id:
            names = conn.execute(
                """
                SELECT a.username AS a_name, b.username AS b_name
                FROM couples c
                JOIN users a ON a.id = c.partner_a_id
                JOIN users b ON b.id = c.partner_b_id
                WHERE c.id = ?
                """,
                (couple_id,),
            ).fetchone()
            parts.append(f"couple:{couple_id}:{names['a_name']}:{names['b_name']}")
            for table in (
                "tasks",
                "partner_manual_entries",
                "shared_footprints",
                "planner_items",
                "planner_day_availability",
                "meetup_invitations",
            ):
                row = conn.execute(
                    f"SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS m FROM {table} WHERE couple_id = ?",
                    (couple_id,),
                ).fetchone()
                parts.append(f"{table}:{row['n']}:{row['m']}")
            row = conn.execute(
                "SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m FROM reward_redemptions WHERE couple_id = ?",
                (couple_id,),
            ).fetchone()
            parts.append(f"rewards:{row['n']}:{row['m']}")
        else:
            row = conn.execute(
                """
                SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS m
                FROM couple_invites
                WHERE inviter_id = ? OR lower(invitee_email) = lower(?)
                """,
                (user_id, user["email"]),
            ).fetchone()
            parts.append(f"invites:{row['n']}:{row['m']}")
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:16]


def completed_summary(couple_id: int, user_id: int | None = None) -> dict:
    clause, params = visible_task_clause(user_id)
    with connect() as conn:
        rows = conn.execute(
            f"""
            SELECT t.completed_by_id AS user_id, COUNT(*) AS count
            FROM tasks t
            WHERE t.couple_id = ? AND t.is_completed = 1 AND t.deleted_at IS NULL AND {clause}
            GROUP BY t.completed_by_id
            """,
            [couple_id, *params],
        ).fetchall()
    by_user = {str(row["user_id"]): row["count"] for row in rows if row["user_id"] is not None}
    return {"total": sum(row["count"] for row in rows), "by_user": by_user}


def bootstrap(user_id: int, today=None) -> dict:
    """Everything the app needs on open, in one request instead of four round trips.

    `today` is the phone's own date (YYYY-MM-DD); it only decides which meetup invitations
    still count for the badge on 週記.
    """
    user_id = int(user_id)
    # Fingerprint first: if something changes while the rest is read, the next poll
    # sees a newer fingerprint and reloads, instead of missing the change.
    version = data_version(user_id)
    user = get_user(user_id)
    result = {
        "version": version,
        "user": user,
        "couple": None,
        "tasks": [],
        "stats": None,
        "completed_summary": {"total": 0, "by_user": {}},
        "manual_count": 0,
        "planner_pending": 0,
    }
    with connect() as conn:
        couple_id = _active_couple_id(conn, user_id)
    if not couple_id:
        return result
    from . import planner  # late import: planner builds on this module

    couple = get_couple(couple_id)
    partner_id = couple["partner_b_id"] if couple["partner_a_id"] == user_id else couple["partner_a_id"]
    with connect() as conn:
        manual_count = conn.execute(
            "SELECT COUNT(*) AS n FROM partner_manual_entries WHERE couple_id = ? AND subject_user_id = ?",
            (couple_id, partner_id),
        ).fetchone()["n"]
        planner_pending = planner.pending_count(conn, couple_id, user_id, today)
    result.update(
        {
            "couple": couple,
            "tasks": list_tasks(couple_id=couple_id, user_id=user_id, view="all"),
            "stats": get_stats(couple_id, user_id=user_id),
            "completed_summary": completed_summary(couple_id, user_id),
            "manual_count": manual_count,
            "planner_pending": planner_pending,
        }
    )
    return result
