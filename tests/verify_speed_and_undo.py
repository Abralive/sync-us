"""Checks for the one-request start-up, change fingerprint, undo, editing, backups and the HTTP layer.

Run: python tests/verify_speed_and_undo.py
"""

import base64
import gzip
import http.client
import json
import os
import sys
import tempfile
import threading
from datetime import timedelta
from pathlib import Path


def expect_error(error_type, func, *args, **kwargs):
    try:
        func(*args, **kwargs)
    except error_type:
        return True
    raise AssertionError(f"{func.__name__} should raise {error_type.__name__}")


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        os.environ["SYNC_US_DB"] = os.path.join(tmpdir, "speed.db")
        os.environ["SYNC_US_BACKUP_DIR"] = os.path.join(tmpdir, "backups")
        os.environ["SYNC_US_LOG_DIR"] = os.path.join(tmpdir, "logs")
        os.environ["SYNC_US_USER"] = "us"
        os.environ["SYNC_US_PASS"] = "星塵-2026"

        from sync_us_app import database, maintenance, services
        from sync_us_app.database import connect, init_db, utc_now_dt

        init_db()
        checks = 0

        def iso(delta):
            return (utc_now_dt() + delta).isoformat()

        def set_task(task_id, **fields):
            with connect() as conn:
                sets = ", ".join(f"{key} = ?" for key in fields)
                conn.execute(f"UPDATE tasks SET {sets} WHERE id = ?", [*fields.values(), task_id])
                conn.commit()

        # --- database settings -------------------------------------------------------
        with connect() as conn:
            assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
            indexes = {row["name"] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'")}
        assert {"idx_tasks_couple_state", "idx_tasks_matched", "idx_couples_partner_a"} <= indexes
        assert database.quick_check() == (True, "ok")
        checks += 1

        # --- bootstrap and fingerprint before pairing ---------------------------------
        mina = services.create_user({"username": "Mina", "email": "mina@example.com"})
        kai = services.create_user({"username": "Kai", "email": "kai@example.com"})
        boot = services.bootstrap(mina["id"])
        assert boot["user"]["id"] == mina["id"] and boot["couple"] is None and boot["tasks"] == []
        expect_error(services.NotFoundError, services.bootstrap, 9999)
        expect_error(services.NotFoundError, services.data_version, 9999)
        v0 = services.data_version(mina["id"])
        assert v0 == services.data_version(mina["id"]), "fingerprint must be stable"
        invite = services.create_couple_invite({"inviter_id": mina["id"]})
        v1 = services.data_version(mina["id"])
        assert v1 != v0, "a new invite must change the fingerprint"
        couple = services.accept_couple_invite(invite["invite_code"], {"user_id": kai["id"]})
        cid = couple["id"]
        assert services.data_version(mina["id"]) != v1
        checks += 1

        # --- bootstrap after pairing ----------------------------------------------------
        trip = services.create_task(
            {"title": "訂 露營 營地", "due_time": iso(timedelta(days=2)), "couple_id": cid, "created_by_id": mina["id"]}
        )
        secret = services.create_task(
            {
                "title": "準備驚喜",
                "due_time": iso(timedelta(days=3)),
                "couple_id": cid,
                "created_by_id": mina["id"],
                "is_private": True,
            }
        )
        boot_kai = services.bootstrap(kai["id"])
        assert boot_kai["couple"]["id"] == cid
        assert [task["id"] for task in boot_kai["tasks"]] == [trip["id"]], "partner must not get private bubbles"
        assert boot_kai["stats"]["private_active"] == {str(mina["id"]): 1}
        assert boot_kai["manual_count"] == 0
        assert boot_kai["completed_summary"] == {"total": 0, "by_user": {}}
        boot_mina = services.bootstrap(mina["id"])
        assert {task["id"] for task in boot_mina["tasks"]} == {trip["id"], secret["id"]}
        services.upsert_manual_entry(cid, kai["id"], {"category": "likes", "label": "飲料", "value": "無糖綠茶"})
        assert services.bootstrap(kai["id"])["manual_count"] == 1, "Kai wrote about Mina"
        assert services.bootstrap(mina["id"])["manual_count"] == 0, "nothing written about Kai yet"
        checks += 1

        # --- fingerprint follows every kind of change ----------------------------------
        def changes(action):
            before = services.data_version(kai["id"])
            action()
            after = services.data_version(kai["id"])
            assert before != after, f"fingerprint did not change for {action}"

        changes(lambda: services.update_task(trip["id"], {"title": "訂 露營 營地和器材"}, kai["id"]))
        changes(lambda: services.upsert_manual_entry(cid, mina["id"], {"category": "health", "label": "過敏", "value": "花生"}))
        changes(lambda: services.update_task(secret["id"], {"title": "準備生日驚喜"}, mina["id"]))
        checks += 1

        # --- editing rules ------------------------------------------------------------------
        assigned = services.update_task(trip["id"], {"assigned_to_id": kai["id"]}, mina["id"])
        assert assigned["assigned_to_id"] == kai["id"]
        unassigned = services.update_task(trip["id"], {"assigned_to_id": None}, mina["id"])
        assert unassigned["assigned_to_id"] is None, "null means 一起照顧"
        expect_error(services.ValidationError, services.update_task, trip["id"], {"is_private": True}, kai["id"])
        expect_error(services.ValidationError, services.update_task, trip["id"], {"title": "x"}, None)
        expect_error(services.ValidationError, services.update_task, trip["id"], {"due_time": iso(-timedelta(hours=1))}, kai["id"])
        expect_error(services.ValidationError, services.update_task, trip["id"], {"description": "長" * 201}, kai["id"])
        # An overdue bubble can still be renamed while keeping its (past) time.
        past = iso(-timedelta(hours=2))
        set_task(trip["id"], due_time=past)
        renamed = services.update_task(trip["id"], {"title": "訂 露營 營地", "due_time": past}, kai["id"])
        assert renamed["title"] == "訂 露營 營地"
        moved = services.update_task(trip["id"], {"due_time": iso(timedelta(days=2))}, kai["id"])
        assert moved["due_time"] != past
        expect_error(services.NotFoundError, services.update_task, secret["id"], {"title": "偷看"}, kai["id"])
        checks += 1

        # --- soft delete and restore -----------------------------------------------------
        errand = services.create_task(
            {"title": "買 露營 瓦斯", "due_time": iso(timedelta(days=1)), "couple_id": cid, "created_by_id": kai["id"]}
        )
        assert services.get_task(errand["id"], kai["id"])["matched_task_id"] == trip["id"]
        before = services.data_version(mina["id"])
        result = services.delete_task(errand["id"], kai["id"])
        assert result["deleted"] is True
        assert services.data_version(mina["id"]) != before
        assert errand["id"] not in {task["id"] for task in services.list_tasks(cid, mina["id"])}
        assert services.get_task(trip["id"], mina["id"])["matched_task_id"] is None
        expect_error(services.NotFoundError, services.get_task, errand["id"], kai["id"])
        expect_error(services.NotFoundError, services.complete_task, errand["id"], kai["id"])
        expect_error(services.NotFoundError, services.update_task, errand["id"], {"title": "x"}, kai["id"])
        expect_error(services.NotFoundError, services.delete_task, errand["id"], kai["id"])
        restored = services.restore_task(errand["id"], mina["id"])
        assert restored["id"] == errand["id"] and restored["deleted_at"] is None
        assert errand["id"] in {task["id"] for task in services.list_tasks(cid, kai["id"])}
        assert services.restore_task(errand["id"], kai["id"])["id"] == errand["id"], "restore is idempotent"
        services.delete_task(errand["id"], kai["id"])
        set_task(errand["id"], deleted_at=iso(-timedelta(hours=25)))
        expect_error(services.ConflictError, services.restore_task, errand["id"], kai["id"])
        set_task(errand["id"], deleted_at=iso(-timedelta(days=8)))
        assert maintenance.purge_deleted_tasks() == 1
        expect_error(services.NotFoundError, services.restore_task, errand["id"], kai["id"])
        # Deleting someone else's private bubble is impossible; your own works.
        expect_error(services.NotFoundError, services.delete_task, secret["id"], kai["id"])
        checks += 1

        # --- undo a completion ---------------------------------------------------------------
        soon = services.create_task(
            {"title": "繳房租", "due_time": iso(timedelta(minutes=30)), "couple_id": cid, "created_by_id": mina["id"]}
        )
        done = services.complete_task(soon["id"], kai["id"])
        assert done["is_completed"] and done["stardust_awarded"] == services.DUST_PER_TASK
        assert services.get_stardust(cid)["stardust"] == services.DUST_PER_TASK
        assert len(services.list_footprints(cid, kai["id"])) == 1
        assert services.bootstrap(kai["id"])["completed_summary"] == {"total": 1, "by_user": {str(kai["id"]): 1}}
        expect_error(services.ValidationError, services.reopen_task, soon["id"], mina["id"])
        before = services.data_version(mina["id"])
        reopened = services.reopen_task(soon["id"], kai["id"])
        assert services.data_version(mina["id"]) != before
        assert not reopened["is_completed"] and reopened["stardust_awarded"] == 0 and reopened["completed_by_id"] is None
        assert services.get_stardust(cid)["stardust"] == 0
        assert services.list_footprints(cid, kai["id"]) == []
        assert soon["id"] in {task["id"] for task in services.list_tasks(cid, mina["id"])}
        assert services.reopen_task(soon["id"], kai["id"])["id"] == soon["id"], "reopening an open bubble is a no-op"
        # Too late to undo.
        services.complete_task(soon["id"], kai["id"])
        set_task(soon["id"], completed_at=iso(-timedelta(minutes=16)))
        expect_error(services.ConflictError, services.reopen_task, soon["id"], kai["id"])
        checks += 1

        # --- undo is refused once the stardust was spent ----------------------------------
        bubbles = []
        # 1 earlier bubble + 6 new ones = 84 stardust; the 80 coffee leaves 4, less than one bubble.
        for index in range(6):
            bubble = services.create_task(
                {"title": f"家務 {index}", "due_time": iso(timedelta(minutes=20)), "couple_id": cid, "created_by_id": kai["id"]}
            )
            bubbles.append(services.complete_task(bubble["id"], kai["id"]))
        assert services.get_stardust(cid)["stardust"] >= 80
        services.redeem_reward(cid, kai["id"], "coffee")
        balance = services.get_stardust(cid)["stardust"]
        assert balance < services.DUST_PER_TASK
        expect_error(services.ConflictError, services.reopen_task, bubbles[-1]["id"], kai["id"])
        assert services.get_stardust(cid)["stardust"] == balance, "a refused undo must not change the jar"
        checks += 1

        # --- check-then-write races: the state check is part of the write ---------------------
        racer = services.create_task(
            {"title": "倒垃圾", "due_time": iso(timedelta(minutes=30)), "couple_id": cid, "created_by_id": kai["id"]}
        )
        real_fetch = services.fetch_task_row

        def stale_once(snapshot):
            calls = {"n": 0}

            def fake(conn, task_id, include_deleted=False):
                calls["n"] += 1
                if calls["n"] == 1:
                    return snapshot  # what the request read just before the partner's change
                return real_fetch(conn, task_id, include_deleted)

            return fake

        with connect() as conn:
            before_complete = conn.execute("SELECT * FROM tasks WHERE id = ?", (racer["id"],)).fetchone()
        services.complete_task(racer["id"], kai["id"])
        services.fetch_task_row = stale_once(before_complete)
        try:
            expect_error(services.ConflictError, services.delete_task, racer["id"], mina["id"])
        finally:
            services.fetch_task_row = real_fetch
        row = services.get_task(racer["id"], kai["id"])
        assert row["is_completed"] and row["deleted_at"] is None, "a completed bubble must never end up deleted"
        services.fetch_task_row = stale_once(before_complete)
        try:
            expect_error(services.ConflictError, services.update_task, racer["id"], {"title": "改名"}, mina["id"])
        finally:
            services.fetch_task_row = real_fetch
        assert services.get_task(racer["id"], kai["id"])["title"] == "倒垃圾"
        # complete after a concurrent delete: refused, nothing awarded
        doomed = services.create_task(
            {"title": "洗碗", "due_time": iso(timedelta(minutes=30)), "couple_id": cid, "created_by_id": kai["id"]}
        )
        with connect() as conn:
            before_delete = conn.execute("SELECT * FROM tasks WHERE id = ?", (doomed["id"],)).fetchone()
        services.delete_task(doomed["id"], mina["id"])
        dust_before = services.get_stardust(cid)["earned"]
        services.fetch_task_row = stale_once(before_delete)
        try:
            expect_error(services.NotFoundError, services.complete_task, doomed["id"], kai["id"])
        finally:
            services.fetch_task_row = real_fetch
        assert services.get_stardust(cid)["earned"] == dust_before
        # purge never removes a completed bubble, even if it was somehow flagged deleted
        set_task(racer["id"], deleted_at=iso(-timedelta(days=9)))
        maintenance.purge_deleted_tasks()
        with connect() as conn:
            assert conn.execute("SELECT COUNT(*) FROM tasks WHERE id = ?", (racer["id"],)).fetchone()[0] == 1
        set_task(racer["id"], deleted_at=None)
        checks += 1

        # --- renaming drops a stale "same thing" pair ------------------------------------------
        tent = services.create_task(
            {"title": "借 帳篷", "due_time": iso(timedelta(days=4)), "couple_id": cid, "created_by_id": mina["id"]}
        )
        stove = services.create_task(
            {"title": "買 帳篷 燈", "due_time": iso(timedelta(days=4)), "couple_id": cid, "created_by_id": kai["id"]}
        )
        assert services.get_task(tent["id"], mina["id"])["matched_task_id"] == stove["id"]
        services.update_task(stove["id"], {"title": "繳 電費"}, kai["id"])
        assert services.get_task(tent["id"], mina["id"])["matched_task_id"] is None
        assert services.get_task(stove["id"], kai["id"])["matched_task_id"] is None
        services.update_task(stove["id"], {"priority_weight": 70}, kai["id"])
        assert services.get_task(stove["id"], kai["id"])["matched_task_id"] is None
        checks += 1

        # --- backups ------------------------------------------------------------------------------
        first = maintenance.backup_database(keep=3)
        assert first and first.exists()
        import sqlite3

        copy = sqlite3.connect(first)
        try:
            assert copy.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 2
            assert copy.execute("PRAGMA journal_mode").fetchone()[0].lower() == "delete"
        finally:
            copy.close()
        for _ in range(4):
            maintenance.backup_database(keep=3)
        assert len(maintenance.list_backups()) == 3
        assert maintenance.latest_backup_age() < timedelta(minutes=1)
        suspect = maintenance.backup_database(keep=3, suspect=True)
        assert suspect.name.startswith("suspect-") and len(maintenance.list_backups()) == 3
        # A failed integrity check pauses backup, prune and purge, and is written for status.bat.
        good = [path.name for path in maintenance.list_backups()]
        real_check = maintenance.quick_check
        maintenance.quick_check = lambda: (False, "Page 5 is never used")
        try:
            assert maintenance.run_maintenance_once(force_backup=True) is False
        finally:
            maintenance.quick_check = real_check
        assert [path.name for path in maintenance.list_backups()] == good, "good backups must stay"
        status = json.loads((Path(os.environ["SYNC_US_LOG_DIR"]) / "status.json").read_text(encoding="utf-8"))
        assert status["integrity_ok"] is False and "Page 5" in status["integrity_detail"]
        assert services.health()["database"] == "integrity-problem"
        assert maintenance.run_maintenance_once() is True and services.health()["ok"]
        checks += 1

        # --- HTTP layer: keep-alive, gzip, 304, auth, size limit -----------------------------------
        from sync_us_app.simple_server import SyncUsRequestHandler, SyncUsServer, configure_logging

        configure_logging()
        server = SyncUsServer(("127.0.0.1", 0), SyncUsRequestHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            token = base64.b64encode("us:星塵-2026".encode("utf-8")).decode("ascii")
            auth = {"Authorization": f"Basic {token}"}
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)

            conn.request("GET", "/api/v1/health")
            response = conn.getresponse()
            response.read()
            assert response.status == 401, "auth is required"

            conn.request("POST", "/api/v1/nope", body=json.dumps({"x": "y" * 50}), headers={**auth, "Content-Type": "application/json"})
            response = conn.getresponse()
            response.read()
            assert response.status == 404
            # Same connection: the unread body above must not break this request.
            conn.request("GET", "/api/v1/health", headers=auth)
            response = conn.getresponse()
            health = json.loads(response.read())
            assert response.status == 200 and health["ok"] and health["database"] == "ok"
            assert response.getheader("Connection", "").lower() != "close"

            conn.request("GET", f"/api/v1/bootstrap?user_id={kai['id']}", headers={**auth, "Accept-Encoding": "gzip"})
            response = conn.getresponse()
            raw = response.read()
            assert response.status == 200 and response.getheader("Content-Encoding") == "gzip"
            data = json.loads(gzip.decompress(raw))
            assert data["couple"]["id"] == cid and data["version"] == services.data_version(kai["id"])

            conn.request("GET", f"/api/v1/version?user_id={kai['id']}", headers=auth)
            response = conn.getresponse()
            assert json.loads(response.read()) == {"version": data["version"]}

            conn.request("GET", "/api/v1/bootstrap?user_id=9999", headers=auth)
            response = conn.getresponse()
            missing = json.loads(response.read())
            assert response.status == 404 and missing["code"] == "user_not_found"
            conn.request("GET", "/api/v1/nothing-here", headers=auth)
            response = conn.getresponse()
            other = json.loads(response.read())
            assert response.status == 404 and "code" not in other, "only a missing account signs people out"

            for sneaky in ("/icons/../index.html", "/icons/%2e%2e/index.html", "/icons/..%2findex.html", "/icons/..\\index.html"):
                conn.request("GET", sneaky)
                response = conn.getresponse()
                response.read()
                assert response.status == 404, f"{sneaky} -> {response.status}"

            conn.request("GET", "/", headers=auth)
            response = conn.getresponse()
            response.read()
            etag = response.getheader("ETag")
            assert response.status == 200 and etag
            conn.request("GET", "/", headers={**auth, "If-None-Match": etag})
            response = conn.getresponse()
            assert response.status == 304 and response.read() == b""

            conn.request(
                "PUT",
                f"/api/v1/tasks/{trip['id']}?user_id={mina['id']}",
                body=json.dumps({"title": "訂 露營 營地（已確認）", "assigned_to_id": None}),
                headers={**auth, "Content-Type": "application/json"},
            )
            response = conn.getresponse()
            assert response.status == 200 and json.loads(response.read())["title"] == "訂 露營 營地（已確認）"

            conn.request("DELETE", f"/api/v1/tasks/{trip['id']}?user_id={mina['id']}", headers=auth)
            response = conn.getresponse()
            assert response.status == 200 and json.loads(response.read())["deleted"] is True
            conn.request(
                "POST",
                f"/api/v1/tasks/{trip['id']}/restore",
                body=json.dumps({"user_id": mina["id"]}),
                headers={**auth, "Content-Type": "application/json"},
            )
            response = conn.getresponse()
            assert response.status == 200 and json.loads(response.read())["id"] == trip["id"]
            conn.close()

            big = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            big.putrequest("POST", "/api/v1/tasks")
            big.putheader("Authorization", auth["Authorization"])
            big.putheader("Content-Length", str(5 * 1024 * 1024))
            big.endheaders()
            response = big.getresponse()
            assert response.status == 413
            big.close()

            manifest = Path(__file__).resolve().parents[1] / "frontend" / "dist" / "manifest.webmanifest"
            if manifest.exists():
                public = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                public.request("GET", "/manifest.webmanifest")
                response = public.getresponse()
                body = response.read()
                assert response.status == 200, "the manifest must load without the password prompt"
                assert json.loads(body)["short_name"]
                public.close()
        finally:
            server.shutdown()
            server.server_close()
        checks += 1

        print(f"{checks} speed, undo and hosting checks passed")


if __name__ == "__main__":
    main()
