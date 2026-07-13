import datetime as dt

import pytest
from firebase_functions import https_fn

import main


def seed_quest(fake_firestore, quest_id, **overrides):
    quest = {
        "title": "Trail Cleanup",
        "description": "Pick up litter along the river trail.",
        "tags": [],
        "eventDate": dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1),
        "eventEndTime": None,
        "orgId": "org-1",
        "orgName": "Trail Org",
        "isDefault": False,
        "rsvpd": [],
    }
    quest.update(overrides)
    fake_firestore.client().collection("quests").document(quest_id).set(quest)
    return quest


def seed_attendance(fake_firestore, quest_id, uid, **overrides):
    attendance = {
        "token": "valid-token",
        "status": "rsvpd",
        "qrExpiresAt": dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1),
        "checkedInAt": None,
    }
    attendance.update(overrides)
    main._attendance_ref(fake_firestore.client(), quest_id, uid).set(attendance)
    return attendance


def seed_user(fake_firestore, uid, name, email):
    fake_firestore.client().collection("users").document(uid).set({"name": name, "email": email})


class TestRsvpToQuest:
    def test_generates_token_and_qr_image(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1")

        result = call(main.rsvp_to_quest, make_request(data={"questId": "quest-1"}, uid="user-1", role="user"))

        assert result["success"] is True
        assert result["qr"].startswith("data:image/png;base64,")
        attendance = main._attendance_ref(fake_firestore.client(), "quest-1", "user-1").get().to_dict()
        assert attendance["status"] == "rsvpd"
        assert attendance["token"]
        assert attendance["checkedInAt"] is None

    def test_rejects_quest_with_no_event_date(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", eventDate=None)

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.rsvp_to_quest, make_request(data={"questId": "quest-1"}, uid="user-1", role="user"))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION


class TestCancelRsvp:
    def test_deletes_attendance_doc(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1")

        call(main.cancel_rsvp, make_request(data={"questId": "quest-1"}, uid="user-1", role="user"))

        snap = main._attendance_ref(fake_firestore.client(), "quest-1", "user-1").get()
        assert not snap.exists


class TestCheckInAttendee:
    def test_valid_token_checks_user_in(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1", token="good-token")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        result = call(main.check_in_attendee, make_request(
            data={"questId": "quest-1", "uid": "user-1", "token": "good-token"},
            uid="org-1",
            role="organization",
        ))

        assert result["success"] is True
        assert result["alreadyCheckedIn"] is False
        assert result["attendee"] == {"uid": "user-1", "name": "Alex", "email": "alex@example.com"}
        attendance = main._attendance_ref(fake_firestore.client(), "quest-1", "user-1").get().to_dict()
        assert attendance["status"] == "checked_in"
        assert attendance["checkedInAt"] is not None

    def test_invalid_token_is_rejected(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1", token="good-token")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.check_in_attendee, make_request(
                data={"questId": "quest-1", "uid": "user-1", "token": "wrong-token"},
                uid="org-1",
                role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED
        # Rejected attempts must not mutate attendance state.
        attendance = main._attendance_ref(fake_firestore.client(), "quest-1", "user-1").get().to_dict()
        assert attendance["status"] == "rsvpd"

    def test_expired_token_is_rejected(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"])
        seed_attendance(
            fake_firestore, "quest-1", "user-1",
            token="good-token",
            qrExpiresAt=dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1),
        )

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.check_in_attendee, make_request(
                data={"questId": "quest-1", "uid": "user-1", "token": "good-token"},
                uid="org-1",
                role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_unknown_uid_is_rejected(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1")
        # No attendance doc at all for "user-1" — never RSVP'd.

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.check_in_attendee, make_request(
                data={"questId": "quest-1", "uid": "user-1", "token": "anything"},
                uid="org-1",
                role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.NOT_FOUND

    def test_second_scan_of_checked_in_code_is_idempotent(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1", token="good-token")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        req = make_request(
            data={"questId": "quest-1", "uid": "user-1", "token": "good-token"},
            uid="org-1",
            role="organization",
        )

        first = call(main.check_in_attendee, req)
        second = call(main.check_in_attendee, req)

        assert first["alreadyCheckedIn"] is False
        assert second["alreadyCheckedIn"] is True

    def test_non_owning_org_cannot_check_in(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"], orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1", token="good-token")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.check_in_attendee, make_request(
                data={"questId": "quest-1", "uid": "user-1", "token": "good-token"},
                uid="org-2",
                role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED

    def test_admin_can_check_in_any_orgs_quest(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"], orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1", token="good-token")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        result = call(main.check_in_attendee, make_request(
            data={"questId": "quest-1", "uid": "user-1", "token": "good-token"},
            uid="admin-1",
            role="admin",
        ))

        assert result["alreadyCheckedIn"] is False


class TestListQuestAttendees:
    def test_reports_checked_in_status_per_attendee(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1", "user-2"], orgId="org-1")
        seed_attendance(
            fake_firestore, "quest-1", "user-1",
            token="t1", status="checked_in", checkedInAt=dt.datetime.now(dt.timezone.utc),
        )
        seed_attendance(fake_firestore, "quest-1", "user-2", token="t2")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_user(fake_firestore, "user-2", "Bo", "bo@example.com")

        result = call(main.list_quest_attendees, make_request(
            data={"questId": "quest-1"}, uid="org-1", role="organization",
        ))

        by_uid = {a["uid"]: a for a in result["attendees"]}
        assert by_uid["user-1"]["status"] == "checked_in"
        assert by_uid["user-1"]["checkedInAt"] is not None
        assert by_uid["user-2"]["status"] == "rsvpd"
        assert by_uid["user-2"]["checkedInAt"] is None
