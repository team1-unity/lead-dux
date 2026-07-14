import pytest
from firebase_functions import https_fn

import main
from tests.helpers import seed_attendance, seed_quest, seed_user


class TestSubmitReview:
    def test_attended_user_can_submit(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1", status="checked_in")

        result = call(main.submit_review, make_request(
            data={"questId": "quest-1", "rating": 5, "body": "Great cleanup!"},
            uid="user-1", role="user",
        ))

        assert result == {"success": True}
        review = main._review_ref(fake_firestore.client(), "quest-1", "user-1").get().to_dict()
        assert review["rating"] == 5
        assert review["body"] == "Great cleanup!"
        quest = fake_firestore.client().collection("quests").document("quest-1").get().to_dict()
        assert quest["reviewCount"] == 1
        assert quest["avgRating"] == 5

    def test_computes_running_average_across_multiple_reviewers(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1", "user-2"])
        seed_attendance(fake_firestore, "quest-1", "user-1", status="checked_in")
        seed_attendance(fake_firestore, "quest-1", "user-2", status="checked_in")

        call(main.submit_review, make_request(
            data={"questId": "quest-1", "rating": 5, "body": "Loved it"}, uid="user-1", role="user",
        ))
        call(main.submit_review, make_request(
            data={"questId": "quest-1", "rating": 3, "body": "It was fine"}, uid="user-2", role="user",
        ))

        quest = fake_firestore.client().collection("quests").document("quest-1").get().to_dict()
        assert quest["reviewCount"] == 2
        assert quest["avgRating"] == 4

    def test_rejects_user_who_never_attended(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1")
        # No attendance doc at all — never RSVP'd, let alone checked in.

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_review, make_request(
                data={"questId": "quest-1", "rating": 4, "body": "Nice"}, uid="user-1", role="user",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_rejects_user_who_rsvpd_but_never_checked_in(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1", status="rsvpd")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_review, make_request(
                data={"questId": "quest-1", "rating": 4, "body": "Nice"}, uid="user-1", role="user",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_rejects_duplicate_review(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1", status="checked_in")
        req = make_request(
            data={"questId": "quest-1", "rating": 5, "body": "Great!"}, uid="user-1", role="user",
        )
        call(main.submit_review, req)

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_review, req)

        assert exc_info.value.code == https_fn.FunctionsErrorCode.ALREADY_EXISTS
        # The second, rejected attempt must not have double-counted.
        quest = fake_firestore.client().collection("quests").document("quest-1").get().to_dict()
        assert quest["reviewCount"] == 1

    def test_rejects_quest_with_no_organization(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"], orgId=None, isDefault=True)
        seed_attendance(fake_firestore, "quest-1", "user-1", status="checked_in")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_review, make_request(
                data={"questId": "quest-1", "rating": 4, "body": "Nice"}, uid="user-1", role="user",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    @pytest.mark.parametrize("bad_rating", [0, 6, -1, 3.5, "5", True, None])
    def test_rejects_invalid_rating(self, fake_firestore, make_request, call, bad_rating):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1", status="checked_in")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_review, make_request(
                data={"questId": "quest-1", "rating": bad_rating, "body": "Nice"}, uid="user-1", role="user",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    @pytest.mark.parametrize("bad_body", ["", "   ", None])
    def test_rejects_empty_body(self, fake_firestore, make_request, call, bad_body):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1", status="checked_in")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_review, make_request(
                data={"questId": "quest-1", "rating": 4, "body": bad_body}, uid="user-1", role="user",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT


class TestGetMyReview:
    def test_returns_none_when_not_reviewed(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1")

        result = call(main.get_my_review, make_request(data={"questId": "quest-1"}, uid="user-1", role="user"))

        assert result == {"review": None}

    def test_returns_own_review_after_submitting(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1", status="checked_in")
        call(main.submit_review, make_request(
            data={"questId": "quest-1", "rating": 4, "body": "Solid event"}, uid="user-1", role="user",
        ))

        result = call(main.get_my_review, make_request(data={"questId": "quest-1"}, uid="user-1", role="user"))

        assert result["review"]["rating"] == 4
        assert result["review"]["body"] == "Solid event"


class TestListQuestReviews:
    def test_owning_org_sees_all_reviews(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1", "user-2"], orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1", status="checked_in")
        seed_attendance(fake_firestore, "quest-1", "user-2", status="checked_in")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_user(fake_firestore, "user-2", "Bo", "bo@example.com")
        call(main.submit_review, make_request(
            data={"questId": "quest-1", "rating": 5, "body": "Loved it"}, uid="user-1", role="user",
        ))
        call(main.submit_review, make_request(
            data={"questId": "quest-1", "rating": 2, "body": "Not great"}, uid="user-2", role="user",
        ))

        result = call(main.list_quest_reviews, make_request(
            data={"questId": "quest-1"}, uid="org-1", role="organization",
        ))

        by_uid = {r["uid"]: r for r in result["reviews"]}
        assert by_uid["user-1"] == {"uid": "user-1", "name": "Alex", "rating": 5, "body": "Loved it", "createdAt": by_uid["user-1"]["createdAt"]}
        assert by_uid["user-2"]["rating"] == 2
        assert by_uid["user-2"]["name"] == "Bo"

    def test_non_owning_org_cannot_list(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.list_quest_reviews, make_request(
                data={"questId": "quest-1"}, uid="org-2", role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED

    def test_admin_can_list_any_orgs_reviews(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"], orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1", status="checked_in")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        call(main.submit_review, make_request(
            data={"questId": "quest-1", "rating": 5, "body": "Loved it"}, uid="user-1", role="user",
        ))

        result = call(main.list_quest_reviews, make_request(
            data={"questId": "quest-1"}, uid="admin-1", role="admin",
        ))

        assert len(result["reviews"]) == 1
