import os
import sys
import tempfile
from pathlib import Path


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        os.environ["SYNC_US_DB"] = os.path.join(tmpdir, "sync_us_invites_test.db")

        from sync_us_app.database import init_db
        from sync_us_app import services

        init_db()

        first = services.create_user({"username": "First", "email": "first@example.com"})
        second = services.create_user({"username": "Second", "email": "second@example.com"})
        outsider = services.create_user({"username": "Outside", "email": "outside@example.com"})

        invite = services.create_couple_invite(
            {"inviter_id": first["id"], "invitee_email": second["email"]}
        )
        assert invite["status"] == "pending"
        assert invite["invite_code"].startswith("SYNC-")

        blocked_wrong_email = False
        try:
            services.accept_couple_invite(invite["invite_code"], {"user_id": outsider["id"]})
        except services.ValidationError:
            blocked_wrong_email = True
        assert blocked_wrong_email, "email-scoped invite must reject a different user"

        couple = services.accept_couple_invite(invite["invite_code"], {"user_id": second["id"]})
        assert couple["partner_a_id"] == first["id"]
        assert couple["partner_b_id"] == second["id"]
        assert couple["status"] == "active"

        first_couple = services.get_user_couple(first["id"])
        second_couple = services.get_user_couple(second["id"])
        assert first_couple["id"] == couple["id"]
        assert second_couple["id"] == couple["id"]

        duplicate_blocked = False
        try:
            services.accept_couple_invite(invite["invite_code"], {"user_id": second["id"]})
        except services.ConflictError:
            duplicate_blocked = True
        assert duplicate_blocked, "accepted invite must not be accepted twice"

        active_user_blocked = False
        try:
            services.create_couple_invite({"inviter_id": first["id"]})
        except services.ConflictError:
            active_user_blocked = True
        assert active_user_blocked, "active couple member must not create another invite"

        third = services.create_user({"username": "Third", "email": "third@example.com"})
        fourth = services.create_user({"username": "Fourth", "email": "fourth@example.com"})
        open_invite = services.create_couple_invite({"inviter_id": third["id"]})

        self_accept_blocked = False
        try:
            services.accept_couple_invite(open_invite["invite_code"], {"user_id": third["id"]})
        except services.ValidationError:
            self_accept_blocked = True
        assert self_accept_blocked, "inviter must not accept their own invite"

        open_couple = services.accept_couple_invite(open_invite["invite_code"], {"user_id": fourth["id"]})
        assert open_couple["partner_a_id"] == third["id"]
        assert open_couple["partner_b_id"] == fourth["id"]

    print("couple invite checks passed")


if __name__ == "__main__":
    main()
