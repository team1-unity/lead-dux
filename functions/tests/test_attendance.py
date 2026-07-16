import datetime as dt

import pytest
from firebase_functions import https_fn

import main
from tests.helpers import seed_attendance, seed_quest, seed_user


class TestRsvpToQuest:
    def test_adds_uid_to_rsvpd(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1")

        result = call(main.rsvp_to_quest, make_request(data={"questId": "quest-1"}, uid="user-1", role="user"))

        assert result == {"success": True}
        quest = fake_firestore.client().collection("quests").document("quest-1").get().to_dict()
        assert "user-1" in quest["rsvpd"]

    def test_rejects_quest_with_no_event_date(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", eventDate=None)

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.rsvp_to_quest, make_request(data={"questId": "quest-1"}, uid="user-1", role="user"))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION


class TestCancelRsvp:
    def test_removes_uid_from_rsvpd(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"])

        call(main.cancel_rsvp, make_request(data={"questId": "quest-1"}, uid="user-1", role="user"))

        quest = fake_firestore.client().collection("quests").document("quest-1").get().to_dict()
        assert "user-1" not in quest["rsvpd"]

    def test_does_not_erase_an_existing_attendance_record(self, fake_firestore, make_request, call):
        # Cancelling an RSVP after already attending shouldn't retroactively
        # un-attend someone — attendance is its own canonical record now.
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1")

        call(main.cancel_rsvp, make_request(data={"questId": "quest-1"}, uid="user-1", role="user"))

        assert main._attendance_ref(fake_firestore.client(), "quest-1", "user-1").get().exists


def _generate_qr(fake_firestore, make_request, call, quest_id="quest-1", uid="org-1", role="organization"):
    return call(main.generate_event_qr_code, make_request(data={"questId": quest_id}, uid=uid, role=role))


class TestGenerateEventQrCode:
    def test_owning_org_generates_a_qr_and_stores_a_token(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")

        result = _generate_qr(fake_firestore, make_request, call)

        assert result["qr"].startswith("data:image/png;base64,")
        quest = fake_firestore.client().collection("quests").document("quest-1").get().to_dict()
        assert quest["qrToken"]
        assert quest["qrTokenVersion"] == 0

    def test_is_idempotent_does_not_rotate_an_existing_token(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        _generate_qr(fake_firestore, make_request, call)
        first_token = fake_firestore.client().collection("quests").document("quest-1").get().to_dict()["qrToken"]

        _generate_qr(fake_firestore, make_request, call)

        second_token = fake_firestore.client().collection("quests").document("quest-1").get().to_dict()["qrToken"]
        assert first_token == second_token

    def test_admin_can_generate_for_any_quest(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")

        result = _generate_qr(fake_firestore, make_request, call, uid="admin-1", role="admin")

        assert result["qr"].startswith("data:image/png;base64,")

    def test_non_owning_org_is_rejected(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            _generate_qr(fake_firestore, make_request, call, uid="org-2", role="organization")

        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED


class TestGetEventQrCode:
    def test_returns_current_qr_without_rotating(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        _generate_qr(fake_firestore, make_request, call)
        token_before = fake_firestore.client().collection("quests").document("quest-1").get().to_dict()["qrToken"]

        result = call(main.get_event_qr_code, make_request(
            data={"questId": "quest-1"}, uid="org-1", role="organization",
        ))

        assert result["qr"].startswith("data:image/png;base64,")
        token_after = fake_firestore.client().collection("quests").document("quest-1").get().to_dict()["qrToken"]
        assert token_before == token_after

    def test_rejects_when_no_qr_generated_yet(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.get_event_qr_code, make_request(
                data={"questId": "quest-1"}, uid="org-1", role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION


class TestRefreshEventQrCode:
    def test_rotates_token_and_bumps_version(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        _generate_qr(fake_firestore, make_request, call)
        before = fake_firestore.client().collection("quests").document("quest-1").get().to_dict()

        call(main.refresh_event_qr_code, make_request(
            data={"questId": "quest-1"}, uid="org-1", role="organization",
        ))

        after = fake_firestore.client().collection("quests").document("quest-1").get().to_dict()
        assert after["qrToken"] != before["qrToken"]
        assert after["qrTokenVersion"] == before["qrTokenVersion"] + 1

    def test_old_token_no_longer_checks_anyone_in(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1", rsvpd=["user-1"])
        _generate_qr(fake_firestore, make_request, call)
        old_token = fake_firestore.client().collection("quests").document("quest-1").get().to_dict()["qrToken"]

        call(main.refresh_event_qr_code, make_request(
            data={"questId": "quest-1"}, uid="org-1", role="organization",
        ))

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.check_in_to_event, make_request(
                data={"questId": "quest-1", "token": old_token}, uid="user-1", role="user",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED

    def test_refresh_preserves_existing_attendance_records(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1")

        call(main.refresh_event_qr_code, make_request(
            data={"questId": "quest-1"}, uid="org-1", role="organization",
        ))

        assert main._attendance_ref(fake_firestore.client(), "quest-1", "user-1").get().exists


class TestCheckInToEvent:
    def _seeded_quest_with_qr(self, fake_firestore, make_request, call, **quest_overrides):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"], **quest_overrides)
        _generate_qr(fake_firestore, make_request, call, uid=quest_overrides.get("orgId", "org-1"))
        return fake_firestore.client().collection("quests").document("quest-1").get().to_dict()["qrToken"]

    def test_valid_token_checks_the_scanning_user_in_and_awards_points(self, fake_firestore, make_request, call):
        token = self._seeded_quest_with_qr(fake_firestore, make_request, call, orgId="org-1")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        result = call(main.check_in_to_event, make_request(
            data={"questId": "quest-1", "token": token}, uid="user-1", role="user",
        ))

        assert result == {"success": True, "alreadyCheckedIn": False, "pointsAwarded": main.ORG_QUEST_BASE_POINTS}
        attendance = main._attendance_ref(fake_firestore.client(), "quest-1", "user-1").get().to_dict()
        assert attendance["userId"] == "user-1"
        assert attendance["orgId"] == "org-1"
        assert attendance["eventId"] == "quest-1"
        assert attendance["checkedInAt"] is not None
        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["points"] == main.ORG_QUEST_BASE_POINTS

    def test_default_quest_awards_no_points(self, fake_firestore, make_request, call):
        token = self._seeded_quest_with_qr(fake_firestore, make_request, call, orgId=None, isDefault=True)

        result = call(main.check_in_to_event, make_request(
            data={"questId": "quest-1", "token": token}, uid="user-1", role="user",
        ))

        assert result["pointsAwarded"] == 0

    def test_invalid_token_is_rejected(self, fake_firestore, make_request, call):
        self._seeded_quest_with_qr(fake_firestore, make_request, call, orgId="org-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.check_in_to_event, make_request(
                data={"questId": "quest-1", "token": "wrong-token"}, uid="user-1", role="user",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED

    def test_no_qr_generated_yet_is_rejected(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"], orgId="org-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.check_in_to_event, make_request(
                data={"questId": "quest-1", "token": "anything"}, uid="user-1", role="user",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED

    def test_expired_window_is_rejected(self, fake_firestore, make_request, call):
        seed_quest(
            fake_firestore, "quest-1", rsvpd=["user-1"], orgId="org-1",
            eventDate=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1),
            eventEndTime=dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1),
        )
        _generate_qr(fake_firestore, make_request, call)
        token = fake_firestore.client().collection("quests").document("quest-1").get().to_dict()["qrToken"]

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.check_in_to_event, make_request(
                data={"questId": "quest-1", "token": token}, uid="user-1", role="user",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_requires_rsvp(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")  # not RSVP'd
        _generate_qr(fake_firestore, make_request, call)
        token = fake_firestore.client().collection("quests").document("quest-1").get().to_dict()["qrToken"]

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.check_in_to_event, make_request(
                data={"questId": "quest-1", "token": token}, uid="user-1", role="user",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_second_scan_is_idempotent_and_does_not_double_award_points(self, fake_firestore, make_request, call):
        token = self._seeded_quest_with_qr(fake_firestore, make_request, call, orgId="org-1")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        req = make_request(data={"questId": "quest-1", "token": token}, uid="user-1", role="user")

        first = call(main.check_in_to_event, req)
        second = call(main.check_in_to_event, req)

        assert first["alreadyCheckedIn"] is False
        assert second["alreadyCheckedIn"] is True
        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["points"] == main.ORG_QUEST_BASE_POINTS


class TestListQuestAttendees:
    def test_reports_checked_in_vs_rsvpd_status_per_attendee(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1", "user-2"], orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1")
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
