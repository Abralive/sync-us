"""雙人週記: a shared weekly notebook with one column per partner.

- Personal notes belong to whoever wrote them. The partner sees them read-only, or only as
  「有行程」 when the owner chose so (calendar imports default to that).
- Each partner marks each day 有空 / 不方便 / 未設定. An empty day is never treated as free.
- When both marked 有空, either one can send a meetup invitation. Accepting it creates ONE
  shared row (owner NULL) that the week view draws across both columns; nobody's personal
  notes are copied, changed or hidden.

Identity always comes from the acting user (the same user_id + couple membership check the
rest of Sync-Us uses), never from owner fields in the request body.

Dates are calendar days ("YYYY-MM-DD", ranges include both ends), never timestamps.
"""

from datetime import date, timedelta
import hashlib
import re
import sqlite3

from .database import connect, utc_now, utc_now_dt
from .services import (
    RESTORE_WINDOW,
    ConflictError,
    NotFoundError,
    UserNotFoundError,
    ValidationError,
    data_version,
    parse_dt,
    require_user,
)

TITLE_MAX = 60
DETAILS_MAX = 200
MAX_RANGE_DAYS = 366  # one note may cover up to a year
INVITE_MAX_DAYS = 14
IMPORT_MAX_EVENTS = 500
IMPORT_KEY_MAX = 1000
PENDING_LIST_LIMIT = 50
DELETED_ITEM_RETENTION = timedelta(days=7)
# The server's date can be a day ahead of a partner in another time zone, so "past" means
# before yesterday on this computer.
PAST_GRACE = timedelta(days=1)

KINDS = {"event", "task", "note"}  # "meetup" only exists on shared rows
VISIBILITY = {"full", "busy_only"}
AVAILABILITY = {"available", "unavailable", "unknown"}
ITEM_FIELDS = ("title", "details", "kind", "start_date", "end_date", "visibility", "task_done")
BUSY_TITLE = "有行程"
MEETUP_TITLE = "一起見面"
UNTITLED_EVENT = "未命名行程"

_DAY_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# --- dates ---------------------------------------------------------------------------


def server_today() -> date:
    """Local date of the computer running Sync-Us (tests may replace this)."""
    return date.today()


def is_past(day: date) -> bool:
    return day < server_today() - PAST_GRACE


def parse_day(value, label: str = "日期") -> date:
    text = str(value or "").strip()
    if not _DAY_PATTERN.match(text):
        raise ValidationError(f"{label}格式不正確，請用 YYYY-MM-DD")
    try:
        return date.fromisoformat(text)
    except ValueError:
        raise ValidationError(f"{label}不是有效的日期") from None


def date_range(start_value, end_value) -> tuple[date, date]:
    start = parse_day(start_value, "開始日期")
    end = parse_day(end_value, "結束日期") if end_value not in (None, "") else start
    if end < start:
        raise ValidationError("結束日期不能早於開始日期")
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise ValidationError("一筆事項最多涵蓋一年")
    return start, end


def week_start(day: date) -> date:
    """Sunday on or before `day` (Sync-Us weeks start on Sunday)."""
    return day - timedelta(days=(day.weekday() + 1) % 7)


# --- who is asking ---------------------------------------------------------------------


def _context(conn: sqlite3.Connection, user_id) -> dict:
    user_id = require_user(user_id)
    user = conn.execute("SELECT id, username FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        raise UserNotFoundError("找不到這個使用者")
    ctx = {
        "user_id": user_id,
        "username": user["username"],
        "couple_id": None,
        "partner_id": None,
        "partner_name": "",
    }
    couple = conn.execute(
        """
        SELECT c.id, c.partner_a_id, c.partner_b_id, a.username AS a_name, b.username AS b_name
        FROM couples c
        JOIN users a ON a.id = c.partner_a_id
        JOIN users b ON b.id = c.partner_b_id
        WHERE c.status = 'active' AND (c.partner_a_id = ? OR c.partner_b_id = ?)
        ORDER BY c.id DESC
        LIMIT 1
        """,
        (user_id, user_id),
    ).fetchone()
    if couple:
        mine_is_a = couple["partner_a_id"] == user_id
        ctx["couple_id"] = couple["id"]
        ctx["partner_id"] = couple["partner_b_id"] if mine_is_a else couple["partner_a_id"]
        ctx["partner_name"] = couple["b_name"] if mine_is_a else couple["a_name"]
    return ctx


def _require_couple(ctx: dict) -> None:
    if not ctx["couple_id"] or ctx["partner_id"] == ctx["user_id"]:
        raise ValidationError("先完成伴侶連結，才能使用週記")


# --- serialisation -------------------------------------------------------------------------

ITEM_SELECT = """
    SELECT p.*, i.from_user_id AS invited_by_id, i.responded_at AS confirmed_at
    FROM planner_items p
    LEFT JOIN meetup_invitations i ON i.id = p.invitation_id
"""


def _item_out(row: sqlite3.Row, viewer_id: int) -> dict:
    item = {
        "id": row["id"],
        "scope": row["scope"],
        "owner_user_id": row["owner_user_id"],
        "kind": row["kind"],
        "title": row["title"],
        "details": row["details"] or "",
        "start_date": row["start_date"],
        "end_date": row["end_date"],
        "task_done": None if row["task_done"] is None else bool(row["task_done"]),
        "source": row["source"],
        "visibility": row["visibility"],
        "status": row["status"],
        "invitation_id": row["invitation_id"],
        "invited_by_id": row["invited_by_id"],
        "confirmed_at": row["confirmed_at"],
        "cancelled_by_id": row["cancelled_by_id"],
        "cancelled_at": row["cancelled_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "mine": row["owner_user_id"] == viewer_id,
        "redacted": False,
    }
    if row["scope"] == "personal" and row["owner_user_id"] != viewer_id and row["visibility"] == "busy_only":
        # The title and notes never leave the server for the partner.
        item.update({"kind": "event", "title": BUSY_TITLE, "details": "", "task_done": None, "redacted": True})
    return item


def _invitation_out(row: sqlite3.Row, viewer_id: int) -> dict:
    return {
        "id": row["id"],
        "from_user_id": row["from_user_id"],
        "to_user_id": row["to_user_id"],
        "start_date": row["start_date"],
        "end_date": row["end_date"],
        "status": row["status"],
        "shared_item_id": row["shared_item_id"],
        "created_at": row["created_at"],
        "responded_at": row["responded_at"],
        "updated_at": row["updated_at"],
        "incoming": row["to_user_id"] == viewer_id,
        "expired": row["status"] == "pending" and is_past(date.fromisoformat(row["start_date"])),
    }


def _fetch_item(conn: sqlite3.Connection, item_id: int, ctx: dict, include_deleted: bool = False) -> sqlite3.Row:
    row = conn.execute(f"{ITEM_SELECT} WHERE p.id = ? AND p.couple_id = ?", (int(item_id), ctx["couple_id"])).fetchone()
    if not row or (row["deleted_at"] and not include_deleted):
        raise NotFoundError("找不到這筆事項")
    return row


def _fetch_invitation(conn: sqlite3.Connection, invitation_id: int, ctx: dict) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM meetup_invitations WHERE id = ? AND couple_id = ?", (int(invitation_id), ctx["couple_id"])
    ).fetchone()
    if not row:
        raise NotFoundError("找不到這個邀請")
    return row


def _own_personal(row: sqlite3.Row, ctx: dict) -> None:
    if row["scope"] != "personal":
        raise ValidationError("共同事項不能在這裡修改，可以打開它取消見面")
    if row["owner_user_id"] != ctx["user_id"]:
        raise ValidationError("只能修改自己欄位裡的事項")


# --- the week ------------------------------------------------------------------------------


def get_week(user_id, start=None) -> dict:
    """Everything one week needs in a single request: both columns, shared rows,
    both partners' day status and the invitations still waiting for an answer."""
    first = parse_day(start, "週的開始日期") if start not in (None, "") else week_start(server_today())
    last = first + timedelta(days=6)
    # Same fingerprint as /version, read first (like /bootstrap): the page can skip a reload
    # when the app's poll reports the version it already shows.
    version = data_version(require_user(user_id))
    with connect() as conn:
        ctx = _context(conn, user_id)
        result = {
            "version": version,
            "paired": bool(ctx["couple_id"]),
            "start": first.isoformat(),
            "end": last.isoformat(),
            "today": server_today().isoformat(),
            "me_id": ctx["user_id"],
            "partner_id": ctx["partner_id"],
            "items": [],
            "availability": [],
            "invitations": [],
        }
        if not ctx["couple_id"]:
            return result
        couple_id, viewer = ctx["couple_id"], ctx["user_id"]
        rows = conn.execute(
            f"""
            {ITEM_SELECT}
            WHERE p.couple_id = ? AND p.deleted_at IS NULL AND p.status = 'active'
              AND p.start_date <= ? AND p.end_date >= ?
            ORDER BY p.start_date, p.id
            """,
            (couple_id, last.isoformat(), first.isoformat()),
        ).fetchall()
        result["items"] = [_item_out(row, viewer) for row in rows]
        result["availability"] = [
            {"user_id": row["user_id"], "date": row["date"], "status": row["status"]}
            for row in conn.execute(
                """
                SELECT user_id, date, status FROM planner_day_availability
                WHERE couple_id = ? AND date BETWEEN ? AND ?
                ORDER BY date, user_id
                """,
                (couple_id, first.isoformat(), last.isoformat()),
            ).fetchall()
        ]
        # Waiting invitations for any later week too (so they can be answered from here),
        # plus this week's expired ones (shown as 已過期). Old expired ones never crowd out
        # new invitations.
        cutoff = (server_today() - PAST_GRACE).isoformat()
        result["invitations"] = [
            _invitation_out(row, viewer)
            for row in conn.execute(
                """
                SELECT * FROM meetup_invitations
                WHERE couple_id = ? AND status = 'pending'
                  AND (start_date >= ? OR (start_date <= ? AND end_date >= ?))
                ORDER BY start_date, id
                LIMIT ?
                """,
                (couple_id, cutoff, last.isoformat(), first.isoformat(), PENDING_LIST_LIMIT),
            ).fetchall()
        ]
    return result


def pending_count(conn: sqlite3.Connection, couple_id: int, user_id: int, today=None) -> int:
    """Invitations waiting for this user's answer (the badge on 週記).

    `today` is the phone's own date, so the badge counts exactly the invitations the page
    still offers 接受 for (a day that already passed on the phone is shown as expired).
    """
    cutoff = (server_today() - PAST_GRACE).isoformat()
    try:
        phone_today = parse_day(today).isoformat() if today else cutoff
    except ValidationError:
        phone_today = cutoff
    return conn.execute(
        """
        SELECT COUNT(*) AS n FROM meetup_invitations
        WHERE couple_id = ? AND to_user_id = ? AND status = 'pending' AND start_date >= ? AND end_date >= ?
        """,
        (couple_id, user_id, cutoff, phone_today),
    ).fetchone()["n"]


# --- personal notes ----------------------------------------------------------------------


def _item_values(data: dict, current: dict | None = None) -> dict:
    """Validated values for a personal note. `current` is the stored row when editing."""
    values = dict(current or {})
    for key in ITEM_FIELDS:
        if key in data:
            values[key] = data[key]

    title = " ".join(str(values.get("title") or "").split())
    if not title:
        raise ValidationError("先寫點什麼再儲存")
    if len(title) > TITLE_MAX:
        raise ValidationError(f"內容最多 {TITLE_MAX} 個字，比較長的可以寫在備註")
    details = str(values.get("details") or "").strip()
    if len(details) > DETAILS_MAX:
        raise ValidationError(f"備註最多 {DETAILS_MAX} 個字")
    kind = str(values.get("kind") or "event")
    if kind not in KINDS:
        raise ValidationError("類別只能是行程、待辦或筆記")
    start, end = date_range(values.get("start_date"), values.get("end_date"))
    visibility = str(values.get("visibility") or "full")
    if visibility not in VISIBILITY:
        raise ValidationError("對方能看到的內容設定不正確")
    if kind == "task":
        task_done = 1 if values.get("task_done") in (True, 1) else 0
    else:
        if data.get("task_done") not in (None, False, 0):
            raise ValidationError("只有待辦可以打勾")
        task_done = None
    return {
        "title": title,
        "details": details,
        "kind": kind,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "visibility": visibility,
        "task_done": task_done,
    }


def create_item(user_id, data: dict) -> dict:
    """Quick add: always into the acting user's own column (owner fields in the body are ignored)."""
    with connect() as conn:
        ctx = _context(conn, user_id)
        _require_couple(ctx)
        values = _item_values(data)
        now = utc_now()
        cur = conn.execute(
            """
            INSERT INTO planner_items (
                couple_id, owner_user_id, scope, kind, title, details, start_date, end_date,
                task_done, source, visibility, status, created_by_id, created_at, updated_at
            )
            VALUES (?, ?, 'personal', ?, ?, ?, ?, ?, ?, 'manual', ?, 'active', ?, ?, ?)
            """,
            (
                ctx["couple_id"],
                ctx["user_id"],
                values["kind"],
                values["title"],
                values["details"],
                values["start_date"],
                values["end_date"],
                values["task_done"],
                values["visibility"],
                ctx["user_id"],
                now,
                now,
            ),
        )
        conn.commit()
        return _item_out(_fetch_item(conn, cur.lastrowid, ctx), ctx["user_id"])


def update_item(item_id, user_id, data: dict) -> dict:
    with connect() as conn:
        ctx = _context(conn, user_id)
        _require_couple(ctx)
        row = _fetch_item(conn, item_id, ctx)
        _own_personal(row, ctx)
        values = _item_values(data, {key: row[key] for key in ITEM_FIELDS})
        cur = conn.execute(
            """
            UPDATE planner_items
            SET title = ?, details = ?, kind = ?, start_date = ?, end_date = ?, visibility = ?,
                task_done = ?, updated_at = ?
            WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL
            """,
            (
                values["title"],
                values["details"],
                values["kind"],
                values["start_date"],
                values["end_date"],
                values["visibility"],
                values["task_done"],
                utc_now(),
                row["id"],
                ctx["user_id"],
            ),
        )
        if cur.rowcount != 1:
            raise ConflictError("這筆事項剛剛被刪除了")
        conn.commit()
        return _item_out(_fetch_item(conn, row["id"], ctx), ctx["user_id"])


def delete_item(item_id, user_id) -> dict:
    """Soft delete, so the 「復原」 button can bring it back for a day."""
    with connect() as conn:
        ctx = _context(conn, user_id)
        _require_couple(ctx)
        row = _fetch_item(conn, item_id, ctx, include_deleted=True)
        _own_personal(row, ctx)
        if not row["deleted_at"]:
            now = utc_now()
            conn.execute(
                "UPDATE planner_items SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
                (now, now, row["id"]),
            )
            conn.commit()
        return {"deleted": True, "id": row["id"]}


def restore_item(item_id, user_id) -> dict:
    with connect() as conn:
        ctx = _context(conn, user_id)
        _require_couple(ctx)
        row = _fetch_item(conn, item_id, ctx, include_deleted=True)
        _own_personal(row, ctx)
        if row["deleted_at"]:
            deleted_at = parse_dt(row["deleted_at"])
            if deleted_at is None or utc_now_dt() - deleted_at > RESTORE_WINDOW:
                raise ConflictError("刪除超過一天，已經無法復原")
            conn.execute(
                "UPDATE planner_items SET deleted_at = NULL, updated_at = ? WHERE id = ?",
                (utc_now(), row["id"]),
            )
            conn.commit()
        return _item_out(_fetch_item(conn, row["id"], ctx), ctx["user_id"])


def purge_deleted_items(older_than: timedelta = DELETED_ITEM_RETENTION) -> int:
    """Clean up personal notes deleted more than a week ago (shared rows are never deleted).

    Notes typed by hand are removed. A deleted calendar import keeps only the hash of its
    event key (title and notes are wiped), so importing the same file again does not bring
    it back.
    """
    cutoff = (utc_now_dt() - older_than).isoformat()
    with connect() as conn:
        removed = conn.execute(
            """
            DELETE FROM planner_items
            WHERE scope = 'personal' AND deleted_at IS NOT NULL AND deleted_at < ? AND external_source_id IS NULL
            """,
            (cutoff,),
        ).rowcount
        wiped = conn.execute(
            """
            UPDATE planner_items SET title = '', details = ''
            WHERE scope = 'personal' AND deleted_at IS NOT NULL AND deleted_at < ?
              AND external_source_id IS NOT NULL AND (title <> '' OR details <> '')
            """,
            (cutoff,),
        ).rowcount
        conn.commit()
        return removed + wiped


# --- day status --------------------------------------------------------------------------


def _write_status(conn: sqlite3.Connection, ctx: dict, day: str, status: str, now: str) -> None:
    if status == "unknown":
        conn.execute(
            "DELETE FROM planner_day_availability WHERE couple_id = ? AND user_id = ? AND date = ?",
            (ctx["couple_id"], ctx["user_id"], day),
        )
    else:
        conn.execute(
            """
            INSERT INTO planner_day_availability (couple_id, user_id, date, status, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(couple_id, user_id, date)
            DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
            """,
            (ctx["couple_id"], ctx["user_id"], day, status, now),
        )


def set_availability(user_id, day, status) -> dict:
    """有空 / 不方便 / 未設定 for the acting user only. It is separate from the notes:
    a busy note does not make a day unavailable, and an empty day is not available.

    An invitation only stands while both partners are 有空, so moving a day off 有空 also
    closes a waiting invitation for it: one I sent is withdrawn, one I received is
    answered 不方便. (An agreed meetup is never cancelled this way.)
    """
    status = str(status or "")
    if status not in AVAILABILITY:
        raise ValidationError("狀態只能是有空、不方便或未設定")
    target = parse_day(day).isoformat()
    with connect() as conn:
        ctx = _context(conn, user_id)
        _require_couple(ctx)
        now = utc_now()
        _write_status(conn, ctx, target, status, now)
        closed = []
        if status != "available":
            waiting = conn.execute(
                """
                SELECT * FROM meetup_invitations
                WHERE couple_id = ? AND status = 'pending' AND start_date <= ? AND end_date >= ?
                """,
                (ctx["couple_id"], target, target),
            ).fetchall()
            for row in waiting:
                if row["from_user_id"] == ctx["user_id"]:
                    conn.execute(
                        "UPDATE meetup_invitations SET status = 'withdrawn', updated_at = ? WHERE id = ? AND status = 'pending'",
                        (now, row["id"]),
                    )
                else:
                    conn.execute(
                        """
                        UPDATE meetup_invitations SET status = 'declined', responded_at = ?, updated_at = ?
                        WHERE id = ? AND status = 'pending'
                        """,
                        (now, now, row["id"]),
                    )
                closed.append(row["id"])
        conn.commit()
        closed_invitations = [_invitation_out(_fetch_invitation(conn, closed_id, ctx), ctx["user_id"]) for closed_id in closed]
    return {"user_id": ctx["user_id"], "date": target, "status": status, "closed_invitations": closed_invitations}


# --- meetup invitations ------------------------------------------------------------------


def _closed_message(row: sqlite3.Row, ctx: dict) -> str:
    status = row["status"]
    if status == "accepted":
        return "這個邀請已經接受了"
    if status == "declined":
        return "你已經回覆不方便了" if row["to_user_id"] == ctx["user_id"] else "對方已經回覆不方便了"
    if status == "withdrawn":
        return "這個邀請已經撤回了"
    if status == "cancelled":
        return "這次見面已經取消了"
    return "這個邀請已經處理過了"


def _invitation_result(conn: sqlite3.Connection, invitation_id: int, ctx: dict) -> dict:
    row = _fetch_invitation(conn, invitation_id, ctx)
    item = None
    if row["shared_item_id"]:
        item = _item_out(_fetch_item(conn, row["shared_item_id"], ctx, include_deleted=True), ctx["user_id"])
    return {"invitation": _invitation_out(row, ctx["user_id"]), "item": item}


def _days(start: str, end: str) -> list[str]:
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    return [(first + timedelta(days=offset)).isoformat() for offset in range((last - first).days + 1)]


def _not_free(conn: sqlite3.Connection, ctx: dict, start: str, end: str) -> set[int]:
    """Which partners are not marked 有空 on every day from start to end (unknown is not free)."""
    free = {
        (row["user_id"], row["date"])
        for row in conn.execute(
            """
            SELECT user_id, date FROM planner_day_availability
            WHERE couple_id = ? AND status = 'available' AND date BETWEEN ? AND ?
            """,
            (ctx["couple_id"], start, end),
        ).fetchall()
    }
    return {
        person
        for person in (ctx["user_id"], ctx["partner_id"])
        if not all((person, day) in free for day in _days(start, end))
    }


def _active_meetup_overlaps(conn: sqlite3.Connection, couple_id: int, start: str, end: str) -> bool:
    return bool(
        conn.execute(
            """
            SELECT 1 FROM planner_items
            WHERE couple_id = ? AND scope = 'shared' AND kind = 'meetup' AND status = 'active'
              AND start_date <= ? AND end_date >= ?
            LIMIT 1
            """,
            (couple_id, end, start),
        ).fetchone()
    )


def create_invitation(user_id, data: dict) -> dict:
    """「邀請見面」: only on days both partners marked 有空. Tapping twice returns the same
    invitation instead of a second one."""
    with connect() as conn:
        ctx = _context(conn, user_id)
        _require_couple(ctx)
        first, last = date_range(data.get("start_date"), data.get("end_date"))
        if (last - first).days + 1 > INVITE_MAX_DAYS:
            raise ValidationError(f"一次最多邀請連續 {INVITE_MAX_DAYS} 天")
        if is_past(first):
            raise ValidationError("這天已經過了，不能再邀請")
        start, end = first.isoformat(), last.isoformat()
        couple_id, me, partner = ctx["couple_id"], ctx["user_id"], ctx["partner_id"]
        if _not_free(conn, ctx, start, end):
            raise ConflictError("要兩個人都標記「有空」，才能邀請見面")
        if _active_meetup_overlaps(conn, couple_id, start, end):
            raise ConflictError("這天已經約好見面了")

        def existing_pending():
            return conn.execute(
                """
                SELECT * FROM meetup_invitations
                WHERE couple_id = ? AND status = 'pending' AND start_date <= ? AND end_date >= ?
                ORDER BY id
                LIMIT 1
                """,
                (couple_id, end, start),
            ).fetchone()

        def answer_existing(row):
            if row["from_user_id"] == me and row["start_date"] == start and row["end_date"] == end:
                return _invitation_result(conn, row["id"], ctx)  # double tap: same invitation
            if row["from_user_id"] == partner:
                raise ConflictError(f"{ctx['partner_name']} 已經邀請你這天見面了，可以直接接受")
            raise ConflictError("這幾天已經有一個等待回覆的邀請")

        row = existing_pending()
        if row:
            return answer_existing(row)
        now = utc_now()
        try:
            cur = conn.execute(
                """
                INSERT INTO meetup_invitations (
                    couple_id, from_user_id, to_user_id, start_date, end_date, status, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
                """,
                (couple_id, me, partner, start, end, now, now),
            )
        except sqlite3.IntegrityError:
            # The other tap (or the partner) got there first.
            conn.rollback()
            row = existing_pending()
            if row:
                return answer_existing(row)
            raise
        conn.commit()
        return _invitation_result(conn, cur.lastrowid, ctx)


def accept_invitation(invitation_id, user_id) -> dict:
    """「接受」: marks the invitation accepted and creates the one shared row, in a single
    transaction. Accepting again (double tap, retried request) returns the same result."""
    with connect() as conn:
        ctx = _context(conn, user_id)
        _require_couple(ctx)
        row = _fetch_invitation(conn, invitation_id, ctx)
        if row["to_user_id"] != ctx["user_id"]:
            raise ValidationError("只有被邀請的人可以接受")
        if row["status"] == "accepted":
            return _invitation_result(conn, row["id"], ctx)
        if row["status"] != "pending":
            raise ConflictError(_closed_message(row, ctx))
        if is_past(date.fromisoformat(row["start_date"])):
            raise ConflictError("這個邀請的日期已經過了")
        if _active_meetup_overlaps(conn, ctx["couple_id"], row["start_date"], row["end_date"]):
            raise ConflictError("這天已經約好見面了")
        now = utc_now()
        cur = conn.execute(
            """
            UPDATE meetup_invitations SET status = 'accepted', responded_at = ?, updated_at = ?
            WHERE id = ? AND status = 'pending'
            """,
            (now, now, row["id"]),
        )
        if cur.rowcount != 1:
            # Answered or withdrawn a moment ago.
            conn.rollback()
            current = _fetch_invitation(conn, row["id"], ctx)
            if current["status"] == "accepted":
                return _invitation_result(conn, row["id"], ctx)
            raise ConflictError(_closed_message(current, ctx))
        # Still both 有空 on every day? (Changing a day's status closes the invitation, so
        # this only catches a change made at the same moment.)
        missing = _not_free(conn, ctx, row["start_date"], row["end_date"])
        if missing:
            conn.rollback()
            who = "你" if ctx["user_id"] in missing else ctx["partner_name"]
            raise ConflictError(f"{who}這天已經不是「有空」了，這個邀請不能接受")
        item = conn.execute(
            """
            INSERT INTO planner_items (
                couple_id, owner_user_id, scope, kind, title, details, start_date, end_date,
                task_done, source, visibility, status, invitation_id, created_by_id, created_at, updated_at
            )
            VALUES (?, NULL, 'shared', 'meetup', ?, '', ?, ?, NULL, 'manual', 'full', 'active', ?, ?, ?, ?)
            """,
            (ctx["couple_id"], MEETUP_TITLE, row["start_date"], row["end_date"], row["id"], ctx["user_id"], now, now),
        )
        conn.execute("UPDATE meetup_invitations SET shared_item_id = ? WHERE id = ?", (item.lastrowid, row["id"]))
        conn.commit()
        return _invitation_result(conn, row["id"], ctx)


def _close_invitation(invitation_id, user_id, new_status: str) -> dict:
    with connect() as conn:
        ctx = _context(conn, user_id)
        _require_couple(ctx)
        row = _fetch_invitation(conn, invitation_id, ctx)
        if new_status == "declined" and row["to_user_id"] != ctx["user_id"]:
            raise ValidationError("只有被邀請的人可以回覆")
        if new_status == "withdrawn" and row["from_user_id"] != ctx["user_id"]:
            raise ValidationError("只有邀請的人可以撤回")
        if row["status"] == new_status:
            return _invitation_result(conn, row["id"], ctx)
        if row["status"] == "accepted":
            raise ConflictError("已經約好了；如果不能去，可以打開這次見面按「取消見面」")
        if row["status"] != "pending":
            raise ConflictError(_closed_message(row, ctx))
        now = utc_now()
        responded = now if new_status == "declined" else row["responded_at"]
        cur = conn.execute(
            """
            UPDATE meetup_invitations SET status = ?, responded_at = ?, updated_at = ?
            WHERE id = ? AND status = 'pending'
            """,
            (new_status, responded, now, row["id"]),
        )
        if cur.rowcount != 1:
            conn.rollback()
            current = _fetch_invitation(conn, row["id"], ctx)
            if current["status"] == new_status:
                return _invitation_result(conn, row["id"], ctx)
            if current["status"] == "accepted":
                raise ConflictError("對方剛剛已經接受了；如果不能去，可以按「取消見面」")
            raise ConflictError(_closed_message(current, ctx))
        if new_status == "declined":
            # The answer is 「不方便」, so those days read 不方便 for both partners (instead of
            # still offering 「兩個人都有空・邀請見面」 right after the answer).
            for day in _days(row["start_date"], row["end_date"]):
                if not is_past(date.fromisoformat(day)):
                    _write_status(conn, ctx, day, "unavailable", now)
        conn.commit()
        return _invitation_result(conn, row["id"], ctx)


def decline_invitation(invitation_id, user_id) -> dict:
    """「不方便」: no shared row is created, personal notes stay, and the day is marked 不方便."""
    return _close_invitation(invitation_id, user_id, "declined")


def withdraw_invitation(invitation_id, user_id) -> dict:
    return _close_invitation(invitation_id, user_id, "withdrawn")


def cancel_shared_item(item_id, user_id) -> dict:
    """Either partner can call off an agreed meetup. The shared row leaves the week view
    (kept as history with who cancelled and when); personal notes are not touched."""
    with connect() as conn:
        ctx = _context(conn, user_id)
        _require_couple(ctx)
        row = _fetch_item(conn, item_id, ctx)
        if row["scope"] != "shared":
            raise ValidationError("個人事項請用刪除")
        if row["status"] == "active":
            now = utc_now()
            cur = conn.execute(
                """
                UPDATE planner_items SET status = 'cancelled', cancelled_by_id = ?, cancelled_at = ?, updated_at = ?
                WHERE id = ? AND status = 'active'
                """,
                (ctx["user_id"], now, now, row["id"]),
            )
            if cur.rowcount == 1 and row["invitation_id"]:
                conn.execute(
                    """
                    UPDATE meetup_invitations SET status = 'cancelled', updated_at = ?
                    WHERE id = ? AND status = 'accepted'
                    """,
                    (now, row["invitation_id"]),
                )
            conn.commit()
        current = _fetch_item(conn, row["id"], ctx)
        invitation = None
        if current["invitation_id"]:
            invitation = _invitation_out(_fetch_invitation(conn, current["invitation_id"], ctx), ctx["user_id"])
        return {"item": _item_out(current, ctx["user_id"]), "invitation": invitation}


# --- calendar import (.ics, read in the browser) ------------------------------------------
#
# The browser parses the .ics file and sends only what the week needs: an event key, the
# summary and the local dates. Descriptions, places and attendees never leave the phone,
# and only a hash of the key is stored (to skip the same event next time).


def _external_id(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:40]


def _import_events(raw) -> list[dict]:
    if not isinstance(raw, list) or not raw:
        raise ValidationError("沒有可以匯入的活動")
    if len(raw) > IMPORT_MAX_EVENTS:
        raise ValidationError(f"一次最多匯入 {IMPORT_MAX_EVENTS} 筆，請把日期範圍縮小一點")
    events = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise ValidationError("活動資料格式不正確")
        key = str(entry.get("key") or "").strip()
        if not key or len(key) > IMPORT_KEY_MAX:
            raise ValidationError("活動缺少識別碼")
        title = " ".join(str(entry.get("title") or "").split()) or UNTITLED_EVENT
        if len(title) > TITLE_MAX:
            title = title[: TITLE_MAX - 1] + "…"
        first, last = date_range(entry.get("start_date"), entry.get("end_date"))
        events.append(
            {
                "key": key,
                "external_id": _external_id(key),
                "title": title,
                "start_date": first.isoformat(),
                "end_date": last.isoformat(),
            }
        )
    return events


def _imported(conn: sqlite3.Connection, ctx: dict) -> dict[str, sqlite3.Row]:
    """My earlier imports by event-key hash, including deleted ones (they stay skipped)."""
    return {
        row["external_source_id"]: row
        for row in conn.execute(
            """
            SELECT external_source_id, start_date, end_date, deleted_at FROM planner_items
            WHERE couple_id = ? AND owner_user_id = ? AND source = 'ics' AND external_source_id IS NOT NULL
            """,
            (ctx["couple_id"], ctx["user_id"]),
        ).fetchall()
    }


def preview_import(user_id, data: dict) -> dict:
    """Marks which events were imported before (including ones imported and then deleted).

    Importing again only adds new events: an event that was imported before is skipped
    even if its date changed in the calendar, so `previous` tells where it is in 週記
    (or that it was deleted), and the person can change it by hand.
    """
    events = _import_events(data.get("events"))
    with connect() as conn:
        ctx = _context(conn, user_id)
        _require_couple(ctx)
        known = _imported(conn, ctx)
    preview, seen = [], set()
    for event in events:
        earlier = known.get(event["external_id"])
        entry = {
            "key": event["key"],
            "title": event["title"],
            "start_date": event["start_date"],
            "end_date": event["end_date"],
            "duplicate": earlier is not None or event["external_id"] in seen,
        }
        if earlier is not None:
            entry["previous"] = {
                "start_date": earlier["start_date"],
                "end_date": earlier["end_date"],
                "deleted": bool(earlier["deleted_at"]),
            }
        seen.add(event["external_id"])
        preview.append(entry)
    new_count = sum(1 for event in preview if not event["duplicate"])
    return {"events": preview, "new_count": new_count, "duplicate_count": len(preview) - new_count}


def confirm_import(user_id, data: dict) -> dict:
    """Adds the chosen events to the importer's own column. By default the partner only sees
    「有行程」. Day status is left alone: a calendar event does not mean the whole day is busy."""
    visibility = str(data.get("visibility") or "busy_only")
    if visibility not in VISIBILITY:
        raise ValidationError("對方能看到的內容設定不正確")
    events = _import_events(data.get("events"))
    with connect() as conn:
        ctx = _context(conn, user_id)
        _require_couple(ctx)
        now = utc_now()
        imported = 0
        for event in events:
            cur = conn.execute(
                """
                INSERT OR IGNORE INTO planner_items (
                    couple_id, owner_user_id, scope, kind, title, details, start_date, end_date,
                    task_done, source, external_source_id, visibility, status, created_by_id,
                    created_at, updated_at
                )
                VALUES (?, ?, 'personal', 'event', ?, '', ?, ?, NULL, 'ics', ?, ?, 'active', ?, ?, ?)
                """,
                (
                    ctx["couple_id"],
                    ctx["user_id"],
                    event["title"],
                    event["start_date"],
                    event["end_date"],
                    event["external_id"],
                    visibility,
                    ctx["user_id"],
                    now,
                    now,
                ),
            )
            imported += cur.rowcount
        conn.commit()
    return {"imported": imported, "skipped": len(events) - imported}
