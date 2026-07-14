import pytest
from firebase_functions import https_fn

import main
from tests.helpers import seed_attendance, seed_quest, seed_user


def get_series(fake_firestore, series_id):
    return fake_firestore.client().collection("questSeries").document(series_id).get().to_dict()


class TestSubmitReview:
    def test_attended_user_can_submit(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1", status="checked_in")

        result = call(main.submit_review, make_request(
            data={"questId": "quest-1", "rating": 5, "body": "Great cleanup!"},
            uid="user-1", role="user",
        ))

        assert result == {"success": True}
        # A standalone quest is its own series (seriesId == quest-1).
        review = main._review_ref(fake_firestore.client(), "quest-1", "user-1", "quest-1").get().to_dict()
        assert review["rating"] == 5
        assert review["body"] == "Great cleanup!"
        series = get_series(fake_firestore, "quest-1")
        assert series["reviewCount"] == 1
        assert series["avgRating"] == 5

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

        series = get_series(fake_firestore, "quest-1")
        assert series["reviewCount"] == 2
        assert series["avgRating"] == 4

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

    def test_rejects_duplicate_review_for_the_same_date(self, fake_firestore, make_request, call):
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
        series = get_series(fake_firestore, "quest-1")
        assert series["reviewCount"] == 1

    def test_allows_a_separate_review_for_a_different_occurrence_in_same_series(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "occ-1", orgId="org-1", seriesId="occ-1", rsvpd=["user-1"])
        seed_quest(fake_firestore, "occ-2", orgId="org-1", seriesId="occ-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "occ-1", "user-1", status="checked_in")
        seed_attendance(fake_firestore, "occ-2", "user-1", status="checked_in")

        call(main.submit_review, make_request(
            data={"questId": "occ-1", "rating": 5, "body": "Loved the first one"}, uid="user-1", role="user",
        ))
        # Attended a second date in the same series and reviews that one
        # too — one review per person PER DATE, not per series.
        result = call(main.submit_review, make_request(
            data={"questId": "occ-2", "rating": 3, "body": "This one was meh"}, uid="user-1", role="user",
        ))

        assert result == {"success": True}
        series = get_series(fake_firestore, "occ-1")
        assert series["reviewCount"] == 2
        assert series["avgRating"] == 4

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

    def test_scoped_to_the_specific_occurrence_not_the_whole_series(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "occ-1", orgId="org-1", seriesId="occ-1", rsvpd=["user-1"])
        seed_quest(fake_firestore, "occ-2", orgId="org-1", seriesId="occ-1")
        seed_attendance(fake_firestore, "occ-1", "user-1", status="checked_in")
        call(main.submit_review, make_request(
            data={"questId": "occ-1", "rating": 5, "body": "Great first date"}, uid="user-1", role="user",
        ))

        # Reviewed occ-1, but occ-2 is a different date the member hasn't
        # reviewed yet — must come back None so the submission form still
        # shows for it, not the read-only "your review" view.
        result = call(main.get_my_review, make_request(data={"questId": "occ-2"}, uid="user-1", role="user"))

        assert result == {"review": None}


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
        assert by_uid["user-1"]["rating"] == 5
        assert by_uid["user-1"]["name"] == "Alex"
        assert by_uid["user-2"]["rating"] == 2
        assert by_uid["user-2"]["name"] == "Bo"

    def test_any_signed_in_member_can_list_reviews(self, fake_firestore, make_request, call):
        # No ownership gate here (unlike list_quest_attendees) — reviews
        # help prospective attendees decide whether to go, so a member
        # who's never RSVP'd, and even a non-owning org, can both read them.
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"], orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1", status="checked_in")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        call(main.submit_review, make_request(
            data={"questId": "quest-1", "rating": 5, "body": "Loved it"}, uid="user-1", role="user",
        ))

        result = call(main.list_quest_reviews, make_request(
            data={"questId": "quest-1"}, uid="user-2", role="user",
        ))

        assert len(result["reviews"]) == 1
        assert result["reviews"][0]["body"] == "Loved it"

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

    def test_reviews_visible_from_any_occurrence_in_series(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "occ-1", orgId="org-1", seriesId="occ-1", rsvpd=["user-1"])
        seed_quest(fake_firestore, "occ-2", orgId="org-1", seriesId="occ-1")
        seed_attendance(fake_firestore, "occ-1", "user-1", status="checked_in")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        call(main.submit_review, make_request(
            data={"questId": "occ-1", "rating": 5, "body": "Great first date"}, uid="user-1", role="user",
        ))

        result = call(main.list_quest_reviews, make_request(
            data={"questId": "occ-2"}, uid="org-1", role="organization",
        ))

        assert len(result["reviews"]) == 1
        assert result["reviews"][0]["body"] == "Great first date"

    def test_shows_a_separate_entry_per_date_a_member_reviewed(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "occ-1", orgId="org-1", seriesId="occ-1", rsvpd=["user-1"])
        seed_quest(fake_firestore, "occ-2", orgId="org-1", seriesId="occ-1", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "occ-1", "user-1", status="checked_in")
        seed_attendance(fake_firestore, "occ-2", "user-1", status="checked_in")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        call(main.submit_review, make_request(
            data={"questId": "occ-1", "rating": 5, "body": "Loved the first one"}, uid="user-1", role="user",
        ))
        call(main.submit_review, make_request(
            data={"questId": "occ-2", "rating": 3, "body": "This one was meh"}, uid="user-1", role="user",
        ))

        result = call(main.list_quest_reviews, make_request(
            data={"questId": "occ-1"}, uid="org-1", role="organization",
        ))

        assert len(result["reviews"]) == 2
        bodies = {r["body"] for r in result["reviews"]}
        assert bodies == {"Loved the first one", "This one was meh"}
