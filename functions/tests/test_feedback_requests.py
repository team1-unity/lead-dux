import datetime as dt

import pytest
from firebase_functions import https_fn

import main
from tests.helpers import seed_attendance, seed_feedback_request, seed_journal_entry, seed_quest, seed_user

VALID_ANSWERS = {"engagement": 8, "presence": 8, "involvement": 8, "initiative": 8, "attitude": 8}  # avg 8.0


def get_request(fake_firestore, quest_id, uid):
    return main._feedback_request_ref(fake_firestore.client(), quest_id, uid).get().to_dict()


def get_journal_entry(fake_firestore, uid, quest_id):
    return main._journal_ref(fake_firestore.client(), uid, quest_id).get().to_dict()


class TestRequestQuestFeedback:
    def test_requires_checked_in_attendance(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.request_quest_feedback, make_request(
                data={"questId": "quest-1"}, uid="user-1", role="user",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_rejects_a_quest_with_no_organization(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId=None, isDefault=True)
        seed_attendance(fake_firestore, "quest-1", "user-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.request_quest_feedback, make_request(
                data={"questId": "quest-1"}, uid="user-1", role="user",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_creates_a_pending_request_and_mirrors_it_onto_the_journal(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1", orgName="Trail Org")
        seed_attendance(fake_firestore, "quest-1", "user-1")
        seed_journal_entry(fake_firestore, "user-1", "quest-1")

        result = call(main.request_quest_feedback, make_request(
            data={"questId": "quest-1"}, uid="user-1", role="user",
        ))

        assert result["success"] is True
        request = get_request(fake_firestore, "quest-1", "user-1")
        assert request["status"] == "pending"
        assert request["uid"] == "user-1"
        assert request["orgId"] == "org-1"

        entry = get_journal_entry(fake_firestore, "user-1", "quest-1")
        assert entry["requestStatus"] == "pending"
        assert entry["expiresAt"] == request["expiresAt"]

    def test_rejects_a_second_request_for_the_same_occurrence(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1")
        seed_feedback_request(fake_firestore, "quest-1", "user-1", status="completed")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.request_quest_feedback, make_request(
                data={"questId": "quest-1"}, uid="user-1", role="user",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_rejects_a_second_request_even_after_the_first_expired(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1")
        seed_feedback_request(
            fake_firestore, "quest-1", "user-1", status="pending",
            expiresAt=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1),
        )

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.request_quest_feedback, make_request(
                data={"questId": "quest-1"}, uid="user-1", role="user",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_rejects_once_the_monthly_cap_is_reached(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1")
        for i in range(main.FEEDBACK_REQUEST_MONTHLY_CAP):
            seed_feedback_request(
                fake_firestore, f"prior-quest-{i}", "user-1", status="completed",
                completedAt=dt.datetime.now(dt.timezone.utc),
            )

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.request_quest_feedback, make_request(
                data={"questId": "quest-1"}, uid="user-1", role="user",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION


class TestSubmitFeedbackRequestResponse:
    def _seed_pending(self, fake_firestore, **overrides):
        seed_quest(fake_firestore, "quest-1", orgId="org-1", orgName="Trail Org")
        seed_attendance(fake_firestore, "quest-1", "user-1")
        seed_journal_entry(fake_firestore, "user-1", "quest-1", requestStatus="pending")
        return seed_feedback_request(fake_firestore, "quest-1", "user-1", **overrides)

    def test_awards_points_when_score_clears_threshold(self, fake_firestore, make_request, call):
        self._seed_pending(fake_firestore)
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        result = call(main.submit_feedback_request_response, make_request(
            data={"questId": "quest-1", "uid": "user-1", "answers": VALID_ANSWERS, "extraThoughts": "Great work!"},
            uid="org-1", role="organization",
        ))

        assert result["score"] == 8.0
        assert result["pointsAwarded"] == main.FEEDBACK_BONUS_POINTS
        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["points"] == main.FEEDBACK_BONUS_POINTS

        request = get_request(fake_firestore, "quest-1", "user-1")
        assert request["status"] == "completed"
        assert request["answers"] == VALID_ANSWERS
        assert request["extraThoughts"] == "Great work!"

        entry = get_journal_entry(fake_firestore, "user-1", "quest-1")
        assert entry["requestStatus"] == "completed"
        assert entry["score"] == 8.0
        assert entry["notified"] is False
        assert entry["read"] is False

    def test_no_points_when_score_is_below_threshold(self, fake_firestore, make_request, call):
        self._seed_pending(fake_firestore)
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        low_answers = {"engagement": 6, "presence": 6, "involvement": 6, "initiative": 5, "attitude": 6}  # avg 5.8

        result = call(main.submit_feedback_request_response, make_request(
            data={"questId": "quest-1", "uid": "user-1", "answers": low_answers},
            uid="org-1", role="organization",
        ))

        assert result["score"] == 5.8
        assert result["pointsAwarded"] == 0
        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user.get("points", 0) == 0

    def test_exact_threshold_score_awards_points(self, fake_firestore, make_request, call):
        self._seed_pending(fake_firestore)
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        threshold_answers = {"engagement": 6, "presence": 6, "involvement": 6, "initiative": 6, "attitude": 6}

        result = call(main.submit_feedback_request_response, make_request(
            data={"questId": "quest-1", "uid": "user-1", "answers": threshold_answers},
            uid="org-1", role="organization",
        ))

        assert result["score"] == 6.0
        assert result["pointsAwarded"] == main.FEEDBACK_BONUS_POINTS

    def test_rejects_an_out_of_range_answer(self, fake_firestore, make_request, call):
        self._seed_pending(fake_firestore)
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        bad_answers = dict(VALID_ANSWERS)
        bad_answers["engagement"] = 11

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_feedback_request_response, make_request(
                data={"questId": "quest-1", "uid": "user-1", "answers": bad_answers},
                uid="org-1", role="organization",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    def test_rejects_answers_missing_a_question(self, fake_firestore, make_request, call):
        self._seed_pending(fake_firestore)
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        incomplete = dict(VALID_ANSWERS)
        del incomplete["attitude"]

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_feedback_request_response, make_request(
                data={"questId": "quest-1", "uid": "user-1", "answers": incomplete},
                uid="org-1", role="organization",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    def test_rejects_a_non_owning_organization(self, fake_firestore, make_request, call):
        self._seed_pending(fake_firestore)
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_feedback_request_response, make_request(
                data={"questId": "quest-1", "uid": "user-1", "answers": VALID_ANSWERS},
                uid="org-2", role="organization",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED

    def test_admin_can_respond_on_behalf_of_the_owning_org(self, fake_firestore, make_request, call):
        self._seed_pending(fake_firestore)
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        result = call(main.submit_feedback_request_response, make_request(
            data={"questId": "quest-1", "uid": "user-1", "answers": VALID_ANSWERS},
            uid="admin-1", role="admin",
        ))
        assert result["pointsAwarded"] == main.FEEDBACK_BONUS_POINTS

    def test_rejects_an_already_completed_request(self, fake_firestore, make_request, call):
        self._seed_pending(fake_firestore, status="completed")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_feedback_request_response, make_request(
                data={"questId": "quest-1", "uid": "user-1", "answers": VALID_ANSWERS},
                uid="org-1", role="organization",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_rejects_an_expired_request(self, fake_firestore, make_request, call):
        self._seed_pending(fake_firestore, expiresAt=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1))
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_feedback_request_response, make_request(
                data={"questId": "quest-1", "uid": "user-1", "answers": VALID_ANSWERS},
                uid="org-1", role="organization",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_rejects_a_missing_request(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_feedback_request_response, make_request(
                data={"questId": "quest-1", "uid": "user-1", "answers": VALID_ANSWERS},
                uid="org-1", role="organization",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.NOT_FOUND

    def test_extra_thoughts_over_length_limit_is_rejected(self, fake_firestore, make_request, call):
        self._seed_pending(fake_firestore)
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_feedback_request_response, make_request(
                data={
                    "questId": "quest-1", "uid": "user-1", "answers": VALID_ANSWERS,
                    "extraThoughts": "x" * (main.EXTRA_THOUGHTS_MAX_LENGTH + 1),
                },
                uid="org-1", role="organization",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT


class TestMonthlyCapBypassFix:
    def test_completing_a_fourth_request_this_month_withholds_points_but_still_records_the_score(
        self, fake_firestore, make_request, call,
    ):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1")
        seed_journal_entry(fake_firestore, "user-1", "quest-1", requestStatus="pending")
        seed_feedback_request(fake_firestore, "quest-1", "user-1", status="pending")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        # 3 other requests already completed earlier this month — the cap
        # is maxed out before this one is even answered, even though this
        # one was allowed to be *requested* (nothing caps pending count).
        for i in range(main.FEEDBACK_REQUEST_MONTHLY_CAP):
            seed_feedback_request(
                fake_firestore, f"prior-quest-{i}", "user-1", status="completed",
                completedAt=dt.datetime.now(dt.timezone.utc),
            )

        result = call(main.submit_feedback_request_response, make_request(
            data={"questId": "quest-1", "uid": "user-1", "answers": VALID_ANSWERS},
            uid="org-1", role="organization",
        ))

        assert result["score"] == 8.0
        assert result["pointsAwarded"] == 0
        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user.get("points", 0) == 0

        request = get_request(fake_firestore, "quest-1", "user-1")
        assert request["status"] == "completed"
        assert request["score"] == 8.0
        assert request["pointsAwarded"] == 0


class TestCheckInCreatesJournalEntry:
    def test_org_quest_check_in_creates_a_journal_entry(self, fake_firestore, make_request, call):
        seed_quest(
            fake_firestore, "quest-1", rsvpd=["user-1"], orgId="org-1", orgName="Trail Org",
            qrToken="good-token", qrTokenVersion=0,
        )
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        call(main.check_in_to_event, make_request(
            data={"questId": "quest-1", "token": "good-token"},
            uid="user-1", role="user",
        ))

        entry = get_journal_entry(fake_firestore, "user-1", "quest-1")
        assert entry is not None
        assert entry["requestStatus"] is None
        assert entry["orgId"] == "org-1"
        # Never defaulted — see the module note in check_in_to_event for
        # why FeedbackToast/BottomNav's `==false` queries rely on this.
        assert "notified" not in entry
        assert "read" not in entry

    def test_side_quest_check_in_creates_no_journal_entry(self, fake_firestore, make_request, call):
        seed_quest(
            fake_firestore, "quest-1", rsvpd=["user-1"], orgId=None, isDefault=True, tier="iron",
            qrToken="good-token", qrTokenVersion=0,
        )
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        call(main.check_in_to_event, make_request(
            data={"questId": "quest-1", "token": "good-token"},
            uid="user-1", role="user",
        ))

        entry = get_journal_entry(fake_firestore, "user-1", "quest-1")
        assert entry is None


class TestFeedbackDataCleanedUpOnQuestDeletion:
    def test_delete_quest_removes_feedback_requests_and_journal_entries(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1")
        seed_journal_entry(fake_firestore, "user-1", "quest-1")
        seed_feedback_request(fake_firestore, "quest-1", "user-1")

        call(main.delete_quest, make_request(data={"questId": "quest-1"}, uid="org-1", role="organization"))

        assert get_request(fake_firestore, "quest-1", "user-1") is None
        assert get_journal_entry(fake_firestore, "user-1", "quest-1") is None


class TestFeedbackDataCleanedUpOnAccountDeletion:
    def test_delete_account_removes_the_leaders_own_journal_and_feedback_requests(
        self, fake_firestore, fake_auth, make_request, call,
    ):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_journal_entry(fake_firestore, "user-1", "quest-1")
        seed_feedback_request(fake_firestore, "quest-1", "user-1")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        call(main.delete_account, make_request(uid="user-1", role="user"))

        assert get_journal_entry(fake_firestore, "user-1", "quest-1") is None
        assert get_request(fake_firestore, "quest-1", "user-1") is None


class TestSubmitQuestReflectionWithoutFeedback:
    def test_reflection_works_even_if_feedback_was_never_requested(self, fake_firestore, make_request, call):
        seed_journal_entry(fake_firestore, "user-1", "quest-1")

        result = call(main.submit_quest_reflection, make_request(
            data={"questId": "quest-1", "body": "Great day."}, uid="user-1", role="user",
        ))

        assert result == {"success": True}
        entry = get_journal_entry(fake_firestore, "user-1", "quest-1")
        assert entry["reflectionBody"] == "Great day."

    def test_rejects_when_no_journal_entry_exists_yet(self, fake_firestore, make_request, call):
        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_quest_reflection, make_request(
                data={"questId": "quest-1", "body": "Too soon."}, uid="user-1", role="user",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.NOT_FOUND
