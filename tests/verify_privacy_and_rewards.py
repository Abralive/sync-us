import os
import sys
import tempfile
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
        os.environ["SYNC_US_DB"] = os.path.join(tmpdir, "sync_us_privacy_test.db")

        from sync_us_app.database import init_db, utc_now_dt
        from sync_us_app import services

        init_db()
        checks = 0

        # --- accounts: normalized, case-insensitive email -------------------------
        mina = services.create_user({"username": " Mina ", "email": " Mina@Example.com "})
        assert mina["email"] == "mina@example.com" and mina["username"] == "Mina"
        expect_error(services.ConflictError, services.create_user, {"username": "Copy", "email": "MINA@example.com"})
        expect_error(services.ValidationError, services.create_user, {"username": "Bad", "email": "not-an-email"})
        assert services.login_user({"email": "MINA@EXAMPLE.COM"})["id"] == mina["id"]
        expect_error(services.NotFoundError, services.login_user, {"email": "nobody@example.com"})
        checks += 1

        kai = services.create_user({"username": "Kai", "email": "kai@example.com"})
        outsider = services.create_user({"username": "Out", "email": "out@example.com"})
        invite = services.create_couple_invite({"inviter_id": mina["id"]})
        couple = services.accept_couple_invite(invite["invite_code"], {"user_id": kai["id"]})
        cid = couple["id"]

        def due(hours):
            return (utc_now_dt() + timedelta(hours=hours)).isoformat() + "Z"

        def make(title, creator, private=False, assigned=None, hours=24):
            return services.create_task({
                "title": title, "due_time": due(hours), "couple_id": cid, "created_by_id": creator["id"],
                "is_private": private, "assigned_to_id": assigned["id"] if assigned else None,
            })

        # --- private bubbles stay private ------------------------------------------
        gift = make("買生日禮物", kai, private=True, assigned=mina)
        assert gift["assigned_to_id"] == kai["id"], "private bubble must belong to its creator"
        shared = make("一起確認住宿", mina)
        for view in ("all", "shared", "private", "mine"):
            titles = [t["title"] for t in services.list_tasks(cid, mina["id"], view)]
            assert "買生日禮物" not in titles, f"partner must not see private bubble in view={view}"
        assert "買生日禮物" in [t["title"] for t in services.list_tasks(cid, kai["id"], "all")]
        assert all(not t["is_private"] for t in services.list_tasks(cid, None, "all"))
        expect_error(services.NotFoundError, services.get_task, gift["id"], mina["id"])
        expect_error(services.NotFoundError, services.get_task, gift["id"])
        expect_error(services.NotFoundError, services.complete_task, gift["id"], mina["id"])
        expect_error(services.NotFoundError, services.complete_task, gift["id"])
        expect_error(services.NotFoundError, services.delete_task, gift["id"], mina["id"])
        expect_error(services.ValidationError, services.delete_task, gift["id"])
        expect_error(services.NotFoundError, services.update_task, gift["id"], {"title": "改掉"}, mina["id"])
        assert services.get_task(gift["id"], kai["id"])["title"] == "買生日禮物"
        stats = services.get_stats(cid, mina["id"])
        assert stats["total"] == 1 and stats["private_active"] == {str(kai["id"]): 1}
        checks += 1

        # --- assignment limited to the couple ------------------------------------------
        expect_error(services.ValidationError, make, "交給外人", mina, False, outsider)
        expect_error(services.ValidationError, make, "不是成員", outsider)
        expect_error(services.ValidationError, make, "   ", mina)
        checks += 1

        # --- deleting a matched bubble no longer trips the foreign key -----------------
        first = make("整理 旅行 清單", mina)
        second = make("旅行 住宿", kai)
        assert services.get_task(first["id"])["matched_task_id"] == second["id"]
        assert services.delete_task(second["id"], mina["id"]) == {"deleted": True}
        assert services.get_task(first["id"])["matched_task_id"] is None

        # turning a matched bubble private removes the match on both sides
        third = make("露營 驚喜", kai)
        fourth = make("露營 行程", mina)
        assert services.get_task(fourth["id"])["matched_task_id"] == third["id"]
        made_private = services.update_task(third["id"], {"is_private": True}, kai["id"])
        assert made_private["is_private"] and made_private["assigned_to_id"] == kai["id"]
        assert services.get_task(fourth["id"])["matched_task_id"] is None
        assert "露營 驚喜" not in [t["title"] for t in services.list_tasks(cid, mina["id"])]
        expect_error(services.ValidationError, services.update_task, fourth["id"], {"assigned_to_id": outsider["id"]}, mina["id"])
        services.complete_task(shared["id"], kai["id"])
        expect_error(services.ConflictError, services.delete_task, shared["id"], mina["id"])
        completed_titles = [t["title"] for t in services.list_completed(cid, mina["id"])]
        assert completed_titles == ["一起確認住宿"]
        checks += 1

        # --- rewards are saved and spend stardust ----------------------------------------
        expect_error(services.ConflictError, services.redeem_reward, cid, mina["id"], "coffee")
        for index in range(7):
            task = make(f"小任務 {index}", mina, hours=1)
            services.complete_task(task["id"], mina["id"])
        rewards = services.list_rewards(cid, kai["id"])
        assert rewards["balance"] >= 80, rewards["balance"]
        before = rewards["balance"]
        after = services.redeem_reward(cid, kai["id"], "coffee")
        assert after["balance"] == before - 80
        assert after["redemptions"][0]["item_title"] == "雙人咖啡券"
        assert services.get_stardust(cid)["stardust"] == after["balance"]
        expect_error(services.ConflictError, services.redeem_reward, cid, mina["id"], "coffee")
        assert services.list_rewards(cid, mina["id"])["balance"] == after["balance"], "a refused redemption must not spend"
        expect_error(services.ValidationError, services.redeem_reward, cid, kai["id"], "unknown")
        expect_error(services.ValidationError, services.list_rewards, cid, outsider["id"])
        checks += 1

    print(f"{checks} privacy and reward checks passed")


if __name__ == "__main__":
    main()
