import os
import sys
import tempfile
from datetime import timedelta
from pathlib import Path


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        os.environ["SYNC_US_DB"] = os.path.join(tmpdir, "sync_us_test.db")

        from sync_us_app.database import connect, init_db, utc_now, utc_now_dt
        from sync_us_app import services

        init_db()

        with connect() as conn:
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
            conn.execute(
                "INSERT INTO users (username, email, created_at) VALUES (?, ?, ?)",
                ("Outside", "outside@sync-us.local", now),
            )
            due = (utc_now_dt() - timedelta(hours=1)).isoformat()
            shared_id = conn.execute(
                """
                INSERT INTO tasks (
                    title, description, due_time, priority_weight, couple_id, created_by_id,
                    assigned_to_id, is_private, reminder_minutes, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, 1, 1, 2, 0, 60, ?, ?)
                """,
                ("確認住宿", "第一次一起規劃旅行。", due, 82, now, now),
            ).lastrowid
            private_id = conn.execute(
                """
                INSERT INTO tasks (
                    title, description, due_time, priority_weight, couple_id, created_by_id,
                    assigned_to_id, is_private, reminder_minutes, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, 1, 1, 1, 1, 60, ?, ?)
                """,
                ("私人提醒", "不進共同足跡。", due, 70, now, now),
            ).lastrowid
            conn.commit()

        services.upsert_manual_entry(
            1,
            1,
            {
                "user_id": 1,
                "subject_user_id": 2,
                "category": "health",
                "label": "過敏",
                "value": "對花生過敏",
                "source_type": "ai_suggestion",
            },
        )
        hidden = services.query_manual(1, 1, "對方對什麼過敏？")
        assert hidden["answer"] == "目前沒有記錄", "pending 手冊資料不應被查詢"

        manual = services.list_manual_entries(1, 1)
        pending_id = manual["entries"][0]["id"]
        services.confirm_manual_entry(pending_id, 1)
        answer = services.query_manual(1, 1, "對方對什麼過敏？")
        assert "花生" in answer["answer"], "確認後的手冊資料應可查詢"
        assert answer["sources"], "AI 查詢答案需要來源"

        completed = services.complete_task(shared_id, 1)
        assert completed["is_completed"], "共享泡泡應完成"
        dust = services.get_stardust(1)
        assert dust["stardust"] >= 12, "直接完成共享泡泡後應取得星塵"
        footprints = services.list_footprints(1, 1)
        assert len(footprints) == 1 and footprints[0]["bubble_id"] == shared_id, "共享泡泡完成後應建立足跡"

        services.complete_task(shared_id, 1)
        assert len(services.list_footprints(1, 1)) == 1, "重複完成同一顆泡泡不可產生重複足跡"

        saved = services.save_task_footprint(
            shared_id,
            1,
            {"note": "第一晚把住宿定下來。", "photo_data_url": "data:image/png;base64,iVBORw0KGgo="},
        )
        assert saved["note"] == "第一晚把住宿定下來。", "足跡補充文字應可更新"
        assert saved["photo_data_url"].startswith("data:image/png"), "足跡照片應可保存"

        services.complete_task(private_id, 1)
        assert len(services.list_footprints(1, 1)) == 1, "私人泡泡不得進入共同足跡"

        blocked = False
        try:
            services.list_footprints(1, 3)
        except services.ValidationError:
            blocked = True
        assert blocked, "非配對使用者不得讀取共同足跡"

    print("6 connection feature checks passed")


if __name__ == "__main__":
    main()
