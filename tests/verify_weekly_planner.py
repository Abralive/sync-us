"""Checks for 雙人週記 (shared weekly notes): dates, permissions, quick add, day status,
meetup invitations, the shared (merged) row, cancelling, calendar import and the HTTP layer.

The numbers in the section titles follow the acceptance list in
Couple_Shared_Weekly_Notes_Codex_Spec.md (section 9).

Run: python tests/verify_weekly_planner.py
"""

import base64
from datetime import date, timedelta
import http.client
import json
import os
from pathlib import Path
import sys
import tempfile
import threading


def expect_error(error_type, func, *args, **kwargs):
    try:
        func(*args, **kwargs)
    except error_type as exc:
        return str(exc)
    raise AssertionError(f"{func.__name__} should raise {error_type.__name__}")


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        os.environ["SYNC_US_DB"] = os.path.join(tmpdir, "planner.db")
        os.environ["SYNC_US_BACKUP_DIR"] = os.path.join(tmpdir, "backups")
        os.environ["SYNC_US_LOG_DIR"] = os.path.join(tmpdir, "logs")
        os.environ["SYNC_US_USER"] = "us"
        os.environ["SYNC_US_PASS"] = "週記-2026"

        from sync_us_app import maintenance, planner, services
        from sync_us_app.database import connect, init_db, utc_now_dt
        from sync_us_app.services import ConflictError, NotFoundError, UserNotFoundError, ValidationError

        init_db()
        init_db()  # the planner tables are added idempotently on every start
        # A fixed "today" (Monday 2026-10-12) keeps every date rule reproducible.
        planner.server_today = lambda: date(2026, 10, 12)
        checks = 0

        def pair(name_a, name_b):
            a = services.create_user({"username": name_a, "email": f"{name_a.lower()}@example.com"})
            b = services.create_user({"username": name_b, "email": f"{name_b.lower()}@example.com"})
            invite = services.create_couple_invite({"inviter_id": a["id"]})
            couple = services.accept_couple_invite(invite["invite_code"], {"user_id": b["id"]})
            return a["id"], b["id"], couple["id"]

        def week(user_id, start="2026-10-11"):
            return planner.get_week(user_id, start)

        def titles(data, owner_id, day):
            return [
                item["title"]
                for item in data["items"]
                if item["owner_user_id"] == owner_id and item["start_date"] <= day <= item["end_date"]
            ]

        def shared_rows(data, day=None):
            return [
                item
                for item in data["items"]
                if item["scope"] == "shared" and (day is None or item["start_date"] <= day <= item["end_date"])
            ]

        def count(sql, *params):
            with connect() as conn:
                return conn.execute(sql, params).fetchone()[0]

        mina, kai, cid = pair("Mina", "Kai")
        lin, wu, other_cid = pair("Lin", "Wu")
        solo = services.create_user({"username": "Solo", "email": "solo@example.com"})["id"]

        # --- schema -------------------------------------------------------------------------
        with connect() as conn:
            names = {row["name"] for row in conn.execute("SELECT name FROM sqlite_master")}
        assert {"planner_items", "planner_day_availability", "meetup_invitations"} <= names
        assert {"idx_planner_items_week", "idx_meetup_one_pending", "idx_planner_items_invitation"} <= names
        checks += 1

        # --- 1. dates: 7 days, across months and years, no UTC shift ---------------------------
        data = week(mina)
        assert (data["start"], data["end"]) == ("2026-10-11", "2026-10-17") and data["paired"] is True
        assert planner.get_week(mina)["start"] == "2026-10-11", "default week starts on Sunday"
        assert planner.week_start(date(2026, 10, 17)) == date(2026, 10, 11)  # Saturday
        assert planner.week_start(date(2026, 10, 11)) == date(2026, 10, 11)  # Sunday itself
        year_end = week(mina, "2026-12-27")
        assert (year_end["start"], year_end["end"]) == ("2026-12-27", "2027-01-02")
        month_end = week(mina, "2026-10-25")
        assert month_end["end"] == "2026-10-31"
        newyear = planner.create_item(mina, {"title": "跨年", "start_date": "2026-12-31", "end_date": "2027-01-01"})
        assert [item["id"] for item in week(mina, "2026-12-27")["items"]] == [newyear["id"]]
        assert week(mina, "2027-01-03")["items"] == [], "the next week starts after it ends"
        assert newyear["start_date"] == "2026-12-31", "dates are stored as typed, never shifted"
        leap = planner.create_item(mina, {"title": "閏日", "start_date": "2028-02-29"})
        assert leap["end_date"] == "2028-02-29", "a single day ends on the same day"
        for bad in ("2026-02-30", "2026-1-5", "10/12", "", "2026-10-12T00:00:00"):
            expect_error(ValidationError, planner.create_item, mina, {"title": "x", "start_date": bad})
        expect_error(ValidationError, planner.create_item, mina, {"title": "x", "start_date": "2026-10-15", "end_date": "2026-10-12"})
        expect_error(ValidationError, planner.create_item, mina, {"title": "x", "start_date": "2026-01-01", "end_date": "2027-06-01"})
        expect_error(ValidationError, planner.get_week, mina, "2026-13-01")
        for item in (newyear, leap):
            planner.delete_item(item["id"], mina)
        checks += 1

        # --- 2. permissions: each person writes only their own column --------------------------
        forged = planner.create_item(
            mina, {"title": "台中工作", "start_date": "2026-10-12", "owner_user_id": kai, "scope": "shared", "source": "ics"}
        )
        assert forged["owner_user_id"] == mina and forged["scope"] == "personal" and forged["source"] == "manual", (
            "owner, scope and source come from the server, never from the request body"
        )
        assert expect_error(ValidationError, planner.update_item, forged["id"], kai, {"title": "改掉"}) == "只能修改自己欄位裡的事項"
        expect_error(ValidationError, planner.delete_item, forged["id"], kai)
        expect_error(ValidationError, planner.restore_item, forged["id"], kai)
        expect_error(NotFoundError, planner.update_item, forged["id"], lin, {"title": "別人的"})
        expect_error(NotFoundError, planner.delete_item, forged["id"], wu)
        assert week(lin)["items"] == [], "another couple sees nothing"
        expect_error(ValidationError, planner.create_item, None, {"title": "x", "start_date": "2026-10-12"})
        expect_error(UserNotFoundError, planner.get_week, 9999)
        checks += 1

        # --- 3. quick add: appears in my column only --------------------------------------------
        trip = planner.create_item(kai, {"title": "  台北   出差 ", "start_date": "2026-10-12"})
        assert trip["title"] == "台北 出差", "extra spaces are tidied"
        mina_view, kai_view = week(mina), week(kai)
        assert titles(mina_view, mina, "2026-10-12") == ["台中工作"]
        assert titles(mina_view, kai, "2026-10-12") == ["台北 出差"]
        assert titles(kai_view, mina, "2026-10-12") == ["台中工作"], "the partner sees it (read only)"
        mine = {item["id"]: item["mine"] for item in mina_view["items"]}
        assert mine[forged["id"]] is True and mine[trip["id"]] is False
        expect_error(ValidationError, planner.create_item, mina, {"title": "   ", "start_date": "2026-10-12"})
        expect_error(ValidationError, planner.create_item, mina, {"title": "長" * 61, "start_date": "2026-10-12"})
        expect_error(ValidationError, planner.create_item, mina, {"title": "x", "start_date": "2026-10-12", "details": "長" * 201})
        expect_error(ValidationError, planner.create_item, mina, {"title": "x", "start_date": "2026-10-12", "kind": "meetup"})
        checks += 1

        # --- 4. tasks and notes need no time or place ------------------------------------------
        ticket = planner.create_item(mina, {"title": "買車票", "start_date": "2026-10-13", "kind": "task"})
        assert ticket["kind"] == "task" and ticket["task_done"] is False
        hotpot = planner.create_item(mina, {"title": "下次想吃火鍋", "start_date": "2026-10-14", "kind": "note"})
        assert hotpot["kind"] == "note" and hotpot["task_done"] is None
        done = planner.update_item(ticket["id"], mina, {"task_done": True})
        assert done["task_done"] is True and done["title"] == "買車票", "ticking keeps the other fields"
        expect_error(ValidationError, planner.update_item, hotpot["id"], mina, {"task_done": True})
        as_event = planner.update_item(ticket["id"], mina, {"kind": "event"})
        assert as_event["task_done"] is None
        assert planner.update_item(ticket["id"], mina, {"kind": "task"})["task_done"] is False
        checks += 1

        # --- 5. a multi-day note is one row shown on every covered day --------------------------
        long_trip = planner.create_item(kai, {"title": "台北出差", "start_date": "2026-10-12", "end_date": "2026-10-15"})
        assert count("SELECT COUNT(*) FROM planner_items WHERE title = '台北出差'") == 1
        kai_view = week(kai)
        for day in ("2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"):
            assert "台北出差" in titles(kai_view, kai, day), day
        assert "台北出差" not in titles(kai_view, kai, "2026-10-16")
        spans = planner.create_item(mina, {"title": "交換學生", "start_date": "2026-09-28", "end_date": "2026-11-03"})
        for start in ("2026-09-27", "2026-10-11", "2026-11-01"):
            assert spans["id"] in [item["id"] for item in week(mina, start)["items"]], start
        moved = planner.update_item(long_trip["id"], kai, {"start_date": "2026-10-13", "end_date": "2026-10-16"})
        assert (moved["start_date"], moved["end_date"]) == ("2026-10-13", "2026-10-16")
        expect_error(ValidationError, planner.update_item, long_trip["id"], kai, {"end_date": "2026-10-01"})
        planner.delete_item(spans["id"], mina)
        checks += 1

        # --- 6. day status: invite only when both said 有空 --------------------------------------
        assert planner.set_availability(mina, "2026-10-17", "available")["status"] == "available"
        msg = expect_error(ConflictError, planner.create_invitation, mina, {"start_date": "2026-10-17"})
        assert "兩個人" in msg, "Kai has not answered (unknown is never free)"
        planner.set_availability(kai, "2026-10-17", "unavailable")
        expect_error(ConflictError, planner.create_invitation, mina, {"start_date": "2026-10-17"})
        planner.set_availability(kai, "2026-10-17", "unknown")
        assert count("SELECT COUNT(*) FROM planner_day_availability WHERE user_id = ? AND date = '2026-10-17'", kai) == 0
        expect_error(ConflictError, planner.create_invitation, kai, {"start_date": "2026-10-17"})
        planner.set_availability(kai, "2026-10-17", "available")
        statuses = {(row["user_id"], row["date"]): row["status"] for row in week(mina)["availability"]}
        assert statuses == {(mina, "2026-10-17"): "available", (kai, "2026-10-17"): "available"}
        expect_error(ValidationError, planner.set_availability, mina, "2026-10-17", "maybe")
        expect_error(ValidationError, planner.set_availability, mina, "17/10", "available")
        expect_error(ValidationError, planner.set_availability, solo, "2026-10-17", "available")
        # A note does not change the day status (being away can still mean free to meet).
        assert planner.create_item(mina, {"title": "出差", "start_date": "2026-10-17"})["kind"] == "event"
        after_note = {(row["user_id"], row["date"]): row["status"] for row in week(mina)["availability"]}
        assert after_note == statuses
        checks += 1

        # --- 7. pending: visible to both, nothing merged yet ------------------------------------
        before_kai = services.data_version(kai)
        sent = planner.create_invitation(mina, {"start_date": "2026-10-17"})
        invitation = sent["invitation"]
        assert invitation["status"] == "pending" and invitation["incoming"] is False and sent["item"] is None
        assert services.data_version(kai) != before_kai, "Kai's screen refreshes within a poll"
        kai_view = week(kai)
        assert kai_view["version"] == services.data_version(kai), "the week carries the same fingerprint as /version"
        assert [(inv["id"], inv["incoming"]) for inv in kai_view["invitations"]] == [(invitation["id"], True)]
        assert shared_rows(kai_view) == [], "no merged row before it is accepted"
        assert services.bootstrap(kai)["planner_pending"] == 1 and services.bootstrap(mina)["planner_pending"] == 0
        again = planner.create_invitation(mina, {"start_date": "2026-10-17"})
        assert again["invitation"]["id"] == invitation["id"], "a second tap returns the same invitation"
        msg = expect_error(ConflictError, planner.create_invitation, kai, {"start_date": "2026-10-17"})
        assert "Mina" in msg, "the partner is told to accept the existing one instead"
        assert count("SELECT COUNT(*) FROM meetup_invitations WHERE status = 'pending'") == 1
        expect_error(ValidationError, planner.accept_invitation, invitation["id"], mina)
        expect_error(ValidationError, planner.withdraw_invitation, invitation["id"], kai)
        expect_error(ValidationError, planner.decline_invitation, invitation["id"], mina)
        expect_error(NotFoundError, planner.accept_invitation, invitation["id"], wu)
        checks += 1

        # --- 8 + 9. accepting creates ONE shared row; personal notes stay -----------------------
        packing = planner.create_item(kai, {"title": "整理行李", "start_date": "2026-10-17"})
        shopping = planner.create_item(mina, {"title": "買東西", "start_date": "2026-10-17"})
        accepted = planner.accept_invitation(invitation["id"], kai)
        shared = accepted["item"]
        assert accepted["invitation"]["status"] == "accepted" and accepted["invitation"]["shared_item_id"] == shared["id"]
        assert shared["scope"] == "shared" and shared["owner_user_id"] is None and shared["kind"] == "meetup"
        assert shared["title"] == "一起見面" and shared["invited_by_id"] == mina and shared["confirmed_at"]
        assert count("SELECT COUNT(*) FROM planner_items WHERE scope = 'shared'") == 1
        for viewer in (mina, kai):
            view = week(viewer)
            rows = shared_rows(view, "2026-10-17")
            assert [row["id"] for row in rows] == [shared["id"]], "both see the same single shared row"
            assert "買東西" in titles(view, mina, "2026-10-17") and "整理行李" in titles(view, kai, "2026-10-17")
            assert view["invitations"] == [], "nothing is waiting any more"
        assert services.bootstrap(kai)["planner_pending"] == 0
        checks += 1

        # --- 10. idempotent: accepting again or at the same moment ------------------------------
        repeat = planner.accept_invitation(invitation["id"], kai)
        assert repeat["item"]["id"] == shared["id"]
        assert count("SELECT COUNT(*) FROM planner_items WHERE scope = 'shared'") == 1
        expect_error(ConflictError, planner.decline_invitation, invitation["id"], kai)
        expect_error(ConflictError, planner.withdraw_invitation, invitation["id"], mina)
        expect_error(ConflictError, planner.create_invitation, mina, {"start_date": "2026-10-17"})  # already agreed

        for person in (mina, kai):
            planner.set_availability(person, "2026-10-24", "available")
        race = planner.create_invitation(kai, {"start_date": "2026-10-24"})["invitation"]
        results, errors = [], []

        def accept_now():
            try:
                results.append(planner.accept_invitation(race["id"], mina)["item"]["id"])
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=accept_now) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        assert not errors, errors
        assert len(set(results)) == 1, "every simultaneous accept returns the same shared row"
        assert count("SELECT COUNT(*) FROM planner_items WHERE invitation_id = ?", race["id"]) == 1

        for person in (mina, kai):
            planner.set_availability(person, "2026-10-31", "available")
        ids, errors = [], []

        def invite_now():
            try:
                ids.append(planner.create_invitation(mina, {"start_date": "2026-10-31"})["invitation"]["id"])
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=invite_now) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        assert not errors, errors
        assert len(set(ids)) == 1, "simultaneous taps create one invitation"
        assert count("SELECT COUNT(*) FROM meetup_invitations WHERE start_date = '2026-10-31'") == 1
        checks += 1

        # --- decline and withdraw ---------------------------------------------------------------
        late = planner.create_invitation(mina, {"start_date": "2026-10-31"})["invitation"]
        declined = planner.decline_invitation(late["id"], kai)
        assert declined["invitation"]["status"] == "declined" and declined["invitation"]["responded_at"]
        assert planner.decline_invitation(late["id"], kai)["invitation"]["status"] == "declined", "repeat is harmless"
        assert expect_error(ConflictError, planner.accept_invitation, late["id"], kai) == "你已經回覆不方便了"
        assert expect_error(ConflictError, planner.withdraw_invitation, late["id"], mina) == "對方已經回覆不方便了"
        assert shared_rows(week(mina, "2026-10-25"), "2026-10-31") == []
        day_status = {(row["user_id"], row["date"]): row["status"] for row in week(mina, "2026-10-25")["availability"]}
        assert day_status[(kai, "2026-10-31")] == "unavailable", "answering 不方便 marks the day 不方便"
        expect_error(ConflictError, planner.create_invitation, mina, {"start_date": "2026-10-31"})
        planner.set_availability(kai, "2026-10-31", "available")
        retry = planner.create_invitation(mina, {"start_date": "2026-10-31"})["invitation"]
        assert retry["id"] != late["id"], "once free again, a new invitation is possible"
        withdrawn = planner.withdraw_invitation(retry["id"], mina)
        assert withdrawn["invitation"]["status"] == "withdrawn"
        assert expect_error(ConflictError, planner.accept_invitation, retry["id"], kai) == "這個邀請已經撤回了"
        checks += 1

        # --- an invitation only stands while both are 有空 ----------------------------------------
        for person in (mina, kai):
            planner.set_availability(person, "2026-11-21", "available")
        first_try = planner.create_invitation(mina, {"start_date": "2026-11-21"})["invitation"]
        changed = planner.set_availability(mina, "2026-11-21", "unavailable")
        assert [(inv["id"], inv["status"]) for inv in changed["closed_invitations"]] == [(first_try["id"], "withdrawn")], (
            "the inviter becoming 不方便 withdraws the invitation"
        )
        assert expect_error(ConflictError, planner.accept_invitation, first_try["id"], kai) == "這個邀請已經撤回了"
        assert shared_rows(week(kai, "2026-11-15")) == [], "no 雙方已確認 row next to a 不方便"
        planner.set_availability(mina, "2026-11-21", "available")
        second_try = planner.create_invitation(mina, {"start_date": "2026-11-21"})["invitation"]
        cleared = planner.set_availability(kai, "2026-11-21", "unknown")
        assert [(inv["id"], inv["status"]) for inv in cleared["closed_invitations"]] == [(second_try["id"], "declined")], (
            "the invitee clearing 有空 answers it"
        )
        assert planner.set_availability(kai, "2026-11-21", "available")["closed_invitations"] == []
        third_try = planner.create_invitation(kai, {"start_date": "2026-11-21"})["invitation"]
        with connect() as conn:  # a status change landing at the same moment as 接受
            conn.execute("DELETE FROM planner_day_availability WHERE user_id = ? AND date = '2026-11-21'", (kai,))
            conn.commit()
        msg = expect_error(ConflictError, planner.accept_invitation, third_try["id"], mina)
        assert msg == "Kai這天已經不是「有空」了，這個邀請不能接受", msg
        assert count("SELECT COUNT(*) FROM planner_items WHERE invitation_id = ?", third_try["id"]) == 0
        assert count("SELECT COUNT(*) FROM meetup_invitations WHERE id = ? AND status = 'pending'", third_try["id"]) == 1, (
            "a refused accept changes nothing"
        )
        planner.withdraw_invitation(third_try["id"], kai)
        checks += 1

        # --- dates that already passed --------------------------------------------------------
        for person in (mina, kai):
            planner.set_availability(person, "2026-10-09", "available")
            planner.set_availability(person, "2026-10-11", "available")
        expect_error(ValidationError, planner.create_invitation, mina, {"start_date": "2026-10-09"})
        yesterday = planner.create_invitation(mina, {"start_date": "2026-10-11"})["invitation"]
        assert yesterday["expired"] is False, "a day of grace for partners in another time zone"
        planner.server_today = lambda: date(2026, 10, 13)
        assert week(kai)["invitations"][0]["expired"] is True
        assert services.bootstrap(kai)["planner_pending"] == 0, "expired invitations leave the badge"
        assert expect_error(ConflictError, planner.accept_invitation, yesterday["id"], kai) == "這個邀請的日期已經過了"
        planner.withdraw_invitation(yesterday["id"], mina)
        planner.server_today = lambda: date(2026, 10, 12)
        expect_error(ValidationError, planner.create_invitation, mina, {"start_date": "2026-10-17", "end_date": "2026-11-17"})
        checks += 1

        # --- the badge counts what the page offers; old invitations never crowd out new ones ---
        for person in (mina, kai):
            planner.set_availability(person, "2026-10-12", "available")
        today_invite = planner.create_invitation(mina, {"start_date": "2026-10-12"})["invitation"]
        assert services.bootstrap(kai, "2026-10-12")["planner_pending"] == 1
        assert services.bootstrap(kai, "2026-10-13")["planner_pending"] == 0, "already past on Kai's phone"
        assert services.bootstrap(kai, "not-a-date")["planner_pending"] == 1, "an unreadable date falls back"
        planner.withdraw_invitation(today_invite["id"], mina)
        with connect() as conn:
            for offset in range(60):
                stale_day = (date(2026, 8, 1) + timedelta(days=offset)).isoformat()
                conn.execute(
                    """
                    INSERT INTO meetup_invitations (couple_id, from_user_id, to_user_id, start_date, end_date, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 'pending', '2026-08-01T00:00:00', '2026-08-01T00:00:00')
                    """,
                    (cid, mina, kai, stale_day, stale_day),
                )
            conn.commit()
        for person in (mina, kai):
            planner.set_availability(person, "2026-12-05", "available")
        fresh = planner.create_invitation(mina, {"start_date": "2026-12-05"})["invitation"]
        listed = [inv["id"] for inv in week(kai)["invitations"]]
        assert listed == [fresh["id"]], "60 forgotten invitations from August do not hide a new one"
        assert services.bootstrap(kai, "2026-10-12")["planner_pending"] == 1
        planner.withdraw_invitation(fresh["id"], mina)
        checks += 1

        # --- 11. cancelling a meetup keeps everything personal ---------------------------------
        cancelled = planner.cancel_shared_item(shared["id"], mina)
        assert cancelled["item"]["status"] == "cancelled" and cancelled["item"]["cancelled_by_id"] == mina
        assert cancelled["invitation"]["status"] == "cancelled"
        assert planner.cancel_shared_item(shared["id"], kai)["item"]["status"] == "cancelled", "repeat is harmless"
        view = week(kai)
        assert shared_rows(view, "2026-10-17") == []
        assert titles(view, mina, "2026-10-17") == ["出差", "買東西"] and titles(view, kai, "2026-10-17") == ["整理行李"]
        assert count("SELECT COUNT(*) FROM planner_items WHERE id = ?", shared["id"]) == 1, "kept as history"
        expect_error(ValidationError, planner.cancel_shared_item, packing["id"], kai)
        expect_error(ValidationError, planner.update_item, shared["id"], mina, {"title": "改名"})
        expect_error(ValidationError, planner.delete_item, shared["id"], mina)
        expect_error(NotFoundError, planner.cancel_shared_item, shared["id"], lin)
        again = planner.create_invitation(kai, {"start_date": "2026-10-17"})["invitation"]
        assert planner.accept_invitation(again["id"], mina)["item"]["id"] != shared["id"], "can be agreed again"
        checks += 1

        # --- personal delete, undo and clean-up -------------------------------------------------
        before = services.data_version(kai)
        planner.delete_item(shopping["id"], mina)
        assert services.data_version(kai) != before
        assert "買東西" not in titles(week(mina), mina, "2026-10-17")
        assert planner.delete_item(shopping["id"], mina)["deleted"] is True, "deleting twice is harmless"
        expect_error(NotFoundError, planner.update_item, shopping["id"], mina, {"title": "x"})
        restored = planner.restore_item(shopping["id"], mina)
        assert restored["title"] == "買東西" and "買東西" in titles(week(mina), mina, "2026-10-17")
        planner.delete_item(shopping["id"], mina)
        with connect() as conn:
            stale = (utc_now_dt() - timedelta(days=2)).isoformat()
            conn.execute("UPDATE planner_items SET deleted_at = ? WHERE id = ?", (stale, shopping["id"]))
            conn.commit()
        assert expect_error(ConflictError, planner.restore_item, shopping["id"], mina) == "刪除超過一天，已經無法復原"
        assert planner.purge_deleted_items(older_than=timedelta(days=1)) == 1
        assert count("SELECT COUNT(*) FROM planner_items WHERE id = ?", shopping["id"]) == 0
        assert count("SELECT COUNT(*) FROM planner_items WHERE scope = 'shared'") >= 1, "shared rows are never purged"
        assert maintenance.run_maintenance_once() is True, "the hourly upkeep runs the planner clean-up too"
        checks += 1

        # --- 12. calendar import: preview, privacy, de-duplication ------------------------------
        events = [
            {"key": "abc@google.com", "title": "牙醫 回診（私人）", "start_date": "2026-10-13"},
            {"key": "trip@google.com", "title": "東京", "start_date": "2026-10-15", "end_date": "2026-10-18"},
            {"key": "abc@google.com", "title": "牙醫 回診（私人）", "start_date": "2026-10-13"},
            {"key": "rrule@x#2026-10-14", "title": "", "start_date": "2026-10-14"},
        ]
        preview = planner.preview_import(kai, {"events": events})
        assert [event["duplicate"] for event in preview["events"]] == [False, False, True, False]
        assert preview["new_count"] == 3 and preview["duplicate_count"] == 1
        assert preview["events"][3]["title"] == "未命名行程"
        availability_before = week(kai)["availability"]
        result = planner.confirm_import(kai, {"events": events})
        assert result == {"imported": 3, "skipped": 1}
        assert week(kai)["availability"] == availability_before, "importing never marks days busy"
        kai_items = [item for item in week(kai)["items"] if item["source"] == "ics"]
        assert len(kai_items) == 3 and all(item["owner_user_id"] == kai and item["visibility"] == "busy_only" for item in kai_items)
        assert "牙醫 回診（私人）" in titles(week(kai), kai, "2026-10-13"), "the importer sees the real title"
        mina_sees = [item for item in week(mina)["items"] if item["source"] == "ics"]
        assert {item["title"] for item in mina_sees} == {"有行程"} and all(item["redacted"] for item in mina_sees)
        assert all(item["details"] == "" for item in mina_sees)
        raw = json.dumps(planner.get_week(mina, "2026-10-11"), ensure_ascii=False)
        assert "牙醫" not in raw and "東京" not in raw, "private titles never reach the partner"
        assert "abc@google.com" not in json.dumps(planner.get_week(kai, "2026-10-11")), "event ids are not sent back"
        with connect() as conn:
            stored = [row[0] for row in conn.execute("SELECT external_source_id FROM planner_items WHERE source = 'ics'")]
        assert all(value and "google" not in value for value in stored), "only a hash of the event id is stored"
        assert planner.confirm_import(kai, {"events": events}) == {"imported": 0, "skipped": 4}
        assert planner.preview_import(kai, {"events": events})["new_count"] == 0
        dentist = next(item for item in kai_items if item["start_date"] == "2026-10-13")
        planner.delete_item(dentist["id"], kai)
        assert planner.preview_import(kai, {"events": events[:1]})["events"][0]["duplicate"] is True, (
            "a deleted import is not brought back by importing the same file again"
        )
        with connect() as conn:
            conn.execute(
                "UPDATE planner_items SET deleted_at = ? WHERE id = ?",
                ((utc_now_dt() - timedelta(days=8)).isoformat(), dentist["id"]),
            )
            conn.commit()
        assert planner.purge_deleted_items() >= 1
        with connect() as conn:
            tomb = conn.execute("SELECT title, details, external_source_id FROM planner_items WHERE id = ?", (dentist["id"],)).fetchone()
        assert tomb is not None and tomb["title"] == "" and tomb["details"] == "" and tomb["external_source_id"], (
            "after the clean-up only the hash of the event key is kept"
        )
        again = planner.preview_import(kai, {"events": events[:1]})["events"][0]
        assert again["duplicate"] is True and again["previous"]["deleted"] is True, "it stays deleted after the clean-up too"
        moved_event = {**events[1], "start_date": "2026-10-20", "end_date": "2026-10-21"}
        moved = planner.preview_import(kai, {"events": [moved_event]})["events"][0]
        assert moved["duplicate"] is True and moved["previous"] == {"start_date": "2026-10-15", "end_date": "2026-10-18", "deleted": False}, (
            "a moved event is not re-imported, and the preview says where the earlier copy is"
        )
        expect_error(ConflictError, planner.restore_item, dentist["id"], kai)
        tokyo = next(item for item in kai_items if item["start_date"] == "2026-10-15")
        assert planner.update_item(tokyo["id"], kai, {"visibility": "full"})["visibility"] == "full"
        assert "東京" in json.dumps(planner.get_week(mina, "2026-10-11"), ensure_ascii=False), "shown once the owner allows it"
        lin_import = planner.confirm_import(lin, {"events": events[:1], "visibility": "full"})
        assert lin_import["imported"] == 1, "another couple's import of the same event is separate"
        expect_error(ValidationError, planner.confirm_import, kai, {"events": []})
        expect_error(ValidationError, planner.confirm_import, kai, {"events": events, "visibility": "public"})
        expect_error(ValidationError, planner.preview_import, kai, {"events": [{"key": "", "start_date": "2026-10-13"}]})
        expect_error(ValidationError, planner.preview_import, kai, {"events": [{"key": "k"}] * 501})
        long_title = planner.preview_import(kai, {"events": [{"key": "long", "title": "長" * 80, "start_date": "2026-10-13"}]})
        assert len(long_title["events"][0]["title"]) == 60 and long_title["events"][0]["title"].endswith("…")
        expect_error(ValidationError, planner.preview_import, solo, {"events": events})
        checks += 1

        # --- 14. not paired yet: guidance instead of someone else's data -----------------------
        lonely = planner.get_week(solo, "2026-10-11")
        assert lonely["paired"] is False and lonely["items"] == [] and lonely["invitations"] == []
        expect_error(ValidationError, planner.create_item, solo, {"title": "x", "start_date": "2026-10-12"})
        expect_error(ValidationError, planner.create_invitation, solo, {"start_date": "2026-10-17"})
        assert services.bootstrap(solo)["planner_pending"] == 0
        checks += 1

        # --- HTTP layer (standard-library server) -----------------------------------------------
        from sync_us_app.simple_server import SyncUsRequestHandler, SyncUsServer, configure_logging

        configure_logging()
        server = SyncUsServer(("127.0.0.1", 0), SyncUsRequestHandler)
        port = server.server_address[1]
        threading.Thread(target=server.serve_forever, daemon=True).start()
        token = base64.b64encode("us:週記-2026".encode("utf-8")).decode("ascii")
        headers = {"Authorization": f"Basic {token}", "Content-Type": "application/json"}
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)

        def call(method, path, body=None, auth=True):
            conn.request(method, path, body=None if body is None else json.dumps(body), headers=headers if auth else {})
            response = conn.getresponse()
            payload = response.read()
            return response.status, (json.loads(payload) if payload else None)

        try:
            assert call("GET", f"/api/v1/planner/week?user_id={mina}", auth=False)[0] == 401
            status, body = call("GET", f"/api/v1/planner/week?user_id={mina}&start=2026-10-11")
            assert status == 200 and body["start"] == "2026-10-11" and body["paired"] is True
            status, created = call("POST", "/api/v1/planner/items", {"user_id": mina, "title": "交報告", "start_date": "2026-10-16", "kind": "task"})
            assert status == 201 and created["owner_user_id"] == mina
            status, ticked = call("PUT", f"/api/v1/planner/items/{created['id']}", {"user_id": mina, "task_done": True})
            assert status == 200 and ticked["task_done"] is True
            assert call("PUT", f"/api/v1/planner/items/{created['id']}", {"user_id": kai, "title": "x"})[0] == 400
            assert call("DELETE", f"/api/v1/planner/items/{created['id']}?user_id={kai}")[0] == 400
            assert call("DELETE", f"/api/v1/planner/items/{created['id']}?user_id={mina}")[0] == 200
            status, back = call("POST", f"/api/v1/planner/items/{created['id']}/restore", {"user_id": mina})
            assert status == 200 and back["title"] == "交報告"
            assert call("DELETE", f"/api/v1/planner/items/{created['id']}?user_id={mina}")[0] == 200
            status, back = call("POST", f"/api/v1/planner/items/{created['id']}/restore?user_id={mina}")
            assert status == 200 and back["title"] == "交報告", "user_id in the query and no body works too"
            status, boot = call("GET", f"/api/v1/bootstrap?user_id={kai}&today=2026-10-12")
            assert status == 200 and boot["planner_pending"] == 0
            status, day = call("PUT", "/api/v1/planner/availability/2026-11-07", {"user_id": mina, "status": "available"})
            assert status == 200 and day["status"] == "available"
            assert call("PUT", "/api/v1/planner/availability/2026-11-07", {"user_id": kai, "status": "available"})[0] == 200
            assert call("PUT", "/api/v1/planner/availability/11-07", {"user_id": kai, "status": "available"})[0] == 400
            status, sent = call("POST", "/api/v1/planner/invitations", {"user_id": mina, "start_date": "2026-11-07"})
            assert status == 201 and sent["invitation"]["status"] == "pending"
            inv_id = sent["invitation"]["id"]
            assert call("POST", f"/api/v1/planner/invitations/{inv_id}/accept", {"user_id": mina})[0] == 400
            status, ok = call("POST", f"/api/v1/planner/invitations/{inv_id}/accept", {"user_id": kai})
            assert status == 200 and ok["item"]["scope"] == "shared"
            status, again = call("POST", f"/api/v1/planner/invitations/{inv_id}/accept", {"user_id": kai})
            assert status == 200 and again["item"]["id"] == ok["item"]["id"]
            status, conflict = call("POST", f"/api/v1/planner/invitations/{inv_id}/withdraw", {"user_id": mina})
            assert status == 409 and conflict["detail"]
            status, off = call("POST", f"/api/v1/planner/shared-items/{ok['item']['id']}/cancel", {"user_id": kai})
            assert status == 200 and off["item"]["status"] == "cancelled"
            status, preview = call(
                "POST", "/api/v1/planner/calendar/import-preview",
                {"user_id": mina, "events": [{"key": "http-1", "title": "社團", "start_date": "2026-11-02"}]},
            )
            assert status == 200 and preview["new_count"] == 1
            status, imported = call(
                "POST", "/api/v1/planner/calendar/import-confirm",
                {"user_id": mina, "events": [{"key": "http-1", "title": "社團", "start_date": "2026-11-02"}]},
            )
            assert status == 200 and imported == {"imported": 1, "skipped": 0}
            assert call("GET", "/api/v1/planner/nowhere?user_id=1")[0] == 404
            assert call("POST", "/api/v1/planner/items/abc/restore", {"user_id": mina})[0] == 404
            assert call("GET", "/api/v1/planner/week")[0] == 400, "user_id is required"
            status, gone = call("GET", "/api/v1/planner/week?user_id=9999")
            assert status == 404 and gone["code"] == "user_not_found", "same sign-out signal as /bootstrap"
            conn.request("POST", "/api/v1/planner/items", body="{oops", headers=headers)
            response = conn.getresponse()
            response.read()
            assert response.status == 400
            status, boot = call("GET", f"/api/v1/bootstrap?user_id={kai}")
            assert status == 200 and "planner_pending" in boot
        finally:
            conn.close()
            server.shutdown()
            server.server_close()
        checks += 1

        # --- FastAPI app (same routes) ----------------------------------------------------------
        try:
            from fastapi.testclient import TestClient
        except ImportError:  # optional dependency
            print("FastAPI not installed: skipped the FastAPI parity check")
        else:
            from sync_us_app.fastapi_app import create_app

            client = TestClient(create_app())
            response = client.get("/api/v1/planner/week", params={"user_id": kai, "start": "2026-11-01"})
            assert response.status_code == 200 and response.json()["paired"] is True
            response = client.post("/api/v1/planner/items", json={"user_id": kai, "title": "報告", "start_date": "2026-11-03"})
            assert response.status_code == 201
            item_id = response.json()["id"]
            assert client.put(f"/api/v1/planner/items/{item_id}", json={"user_id": mina, "title": "x"}).status_code == 400
            assert client.delete(f"/api/v1/planner/items/{item_id}", params={"user_id": kai}).status_code == 200
            response = client.post(f"/api/v1/planner/items/{item_id}/restore", params={"user_id": kai})
            assert response.status_code == 200, "no body needed, like the standard-library server"
            assert client.get("/api/v1/bootstrap", params={"user_id": kai, "today": "2026-10-12"}).json()["planner_pending"] == 0
            assert client.put("/api/v1/planner/availability/2026-11-14", json={"user_id": kai, "status": "available"}).status_code == 200
            assert client.put("/api/v1/planner/availability/2026-11-14", json={"user_id": mina, "status": "available"}).status_code == 200
            response = client.post("/api/v1/planner/invitations", json={"user_id": kai, "start_date": "2026-11-14"})
            assert response.status_code == 201
            inv_id = response.json()["invitation"]["id"]
            assert client.post(f"/api/v1/planner/invitations/{inv_id}/decline", json={"user_id": mina}).status_code == 200
            assert client.post(f"/api/v1/planner/invitations/{inv_id}/accept", json={"user_id": mina}).status_code == 409
            response = client.get("/api/v1/planner/week", params={"user_id": 9999})
            assert response.status_code == 404 and response.json()["code"] == "user_not_found"
            checks += 1

        print(f"weekly planner checks passed: {checks}")


if __name__ == "__main__":
    main()
