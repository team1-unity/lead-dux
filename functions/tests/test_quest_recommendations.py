import json

import main
from tests.helpers import seed_photo_submission, seed_quest, seed_user

ONBOARDING_PAYLOAD = {
    "name": "Alex",
    "age": 25,
    "location": "Jersey City, NJ, USA",
    "placeId": "ChIJ_test_place_id",
    "lat": 40.7178,
    "lng": -74.0431,
    "interests": ["environment"],
    "experienceLevel": "new",
    "timeAvailability": "weekly",
    "groupPreference": "solo",
    "motivation": "community",
    "leaderGoal": "Build confidence organizing locally.",
}


def _recommendations_json(picks):
    return json.dumps({"recommendations": picks})


# A simple, attendance-agnostic way to fire a refresh for tests that don't
# care what triggered it (prompt content, Gemini-failure handling, response
# validation, series expansion) — update_accommodation_needs is still a
# refresh trigger (see functions/main.py), same role as update_interests
# used to fill before it was removed.
def _trigger_refresh(make_request, call, uid="user-1"):
    call(main.update_accommodation_needs, make_request(
        data={"accommodationNeeds": ["wheelchair-accessible"]}, uid=uid, role="user",
    ))


def _checked_in_org_quest(fake_firestore, make_request, call, quest_id="quest-1", uid="user-1", org_id="org-1", **overrides):
    seed_quest(fake_firestore, quest_id, orgId=org_id, rsvpd=[uid], **overrides)
    call(main.generate_event_qr_code, make_request(data={"questId": quest_id}, uid=org_id, role="organization"))
    token = fake_firestore.client().collection("quests").document(quest_id).get().to_dict()["qrToken"]
    return call(main.check_in_to_event, make_request(data={"questId": quest_id, "token": token}, uid=uid, role="user"))


class TestTriggersRecommendationRefresh:
    def test_submit_onboarding_generates_a_ranking(self, fake_firestore, fake_auth, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_quest(fake_firestore, "quest-1", title="River Cleanup", tags=["environment"])
        fake_genai.queue_response(_recommendations_json([{"questId": "quest-1", "reason": "Matches your interests."}]))

        call(main.submit_onboarding, make_request(data=ONBOARDING_PAYLOAD, uid="user-1", role="onboarding_user"))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["recommendedQuestOrder"] == ["quest-1"]
        assert user["recommendedQuestReasons"] == {"quest-1": "Matches your interests."}
        assert "recommendedAt" in user

    def test_update_accommodation_needs_generates_a_ranking(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_quest(fake_firestore, "quest-1")
        fake_genai.queue_response(_recommendations_json([{"questId": "quest-1", "reason": "Accessible to you."}]))

        call(main.update_accommodation_needs, make_request(
            data={"accommodationNeeds": ["wheelchair-accessible"]}, uid="user-1", role="user",
        ))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["recommendedQuestOrder"] == ["quest-1"]

    # There's no equivalent "update_interests" case anymore — interests has
    # no Settings control left to update it with (see the module note above
    # functions/main.py's _generate_quest_recommendations). Attendance is
    # the only thing that changes a ranking after onboarding now; see
    # TestAttendanceBasedRefresh below for that.


class TestAttendanceBasedRefresh:
    def test_fifth_attended_org_quest_triggers_a_refresh(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com", questsAttended=4)
        seed_quest(fake_firestore, "quest-2", tags=["environment"])
        fake_genai.queue_response(_recommendations_json([{"questId": "quest-2", "reason": "Fits your recent activity."}]))

        result = _checked_in_org_quest(fake_firestore, make_request, call, quest_id="quest-1")

        assert result["alreadyCheckedIn"] is False
        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["questsAttended"] == 5
        assert user["recommendedQuestOrder"] == ["quest-2"]

    def test_attendance_short_of_the_interval_does_not_refresh(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")  # questsAttended starts unset (0)

        _checked_in_org_quest(fake_firestore, make_request, call)

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["questsAttended"] == 1
        assert "recommendedQuestOrder" not in user
        assert fake_genai.last_prompt is None  # never even called Gemini

    def test_side_quest_completion_via_photo_approval_counts_toward_the_interval(
        self, fake_firestore, fake_genai, make_request, call,
    ):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com", questsAttended=4)
        seed_quest(fake_firestore, "side-quest", orgId=None, isDefault=True, tier="bronze", rsvpd=["user-1"])
        seed_photo_submission(fake_firestore, "side-quest", "user-1", orgId=None, isDefault=True)
        seed_quest(fake_firestore, "quest-1", tags=["environment"])
        fake_genai.queue_response(_recommendations_json([{"questId": "quest-1", "reason": "Fits."}]))

        call(main.approve_photo_submission, make_request(
            data={"questId": "side-quest", "userId": "user-1"}, uid="admin-1", role="admin",
        ))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["questsAttended"] == 5
        assert user["recommendedQuestOrder"] == ["quest-1"]

    def test_org_quest_photo_bonus_after_checkin_does_not_double_count(self, fake_firestore, fake_genai, make_request, call):
        # Attendance was already recorded at check-in — the +5 photo-bonus
        # approval that can follow for the same org quest must not count as
        # a second completed quest, and must not double-tally its tags.
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        _checked_in_org_quest(fake_firestore, make_request, call, tags=["environment"])
        seed_photo_submission(fake_firestore, "quest-1", "user-1")

        call(main.approve_photo_submission, make_request(
            data={"questId": "quest-1", "userId": "user-1"}, uid="org-1", role="organization",
        ))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["questsAttended"] == 1
        assert user["attendedTagCounts"] == {"environment": 1}

    def test_check_in_records_the_quests_tags(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        _checked_in_org_quest(fake_firestore, make_request, call, tags=["environment", "outdoors"])

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["attendedTagCounts"] == {"environment": 1, "outdoors": 1}

    def test_tag_counts_accumulate_across_multiple_attended_quests(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        _checked_in_org_quest(fake_firestore, make_request, call, quest_id="quest-1", tags=["environment"])

        _checked_in_org_quest(fake_firestore, make_request, call, quest_id="quest-2", tags=["environment", "youth"])

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["attendedTagCounts"] == {"environment": 2, "youth": 1}

    def test_side_quest_photo_approval_records_its_tags(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_quest(
            fake_firestore, "side-quest", orgId=None, isDefault=True, tier="bronze",
            rsvpd=["user-1"], tags=["youth"],
        )
        seed_photo_submission(fake_firestore, "side-quest", "user-1", orgId=None, isDefault=True)

        call(main.approve_photo_submission, make_request(
            data={"questId": "side-quest", "userId": "user-1"}, uid="admin-1", role="admin",
        ))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["attendedTagCounts"] == {"youth": 1}

    def test_repeat_check_in_does_not_double_count(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_quest(fake_firestore, "quest-1", orgId="org-1", rsvpd=["user-1"])
        call(main.generate_event_qr_code, make_request(data={"questId": "quest-1"}, uid="org-1", role="organization"))
        token = fake_firestore.client().collection("quests").document("quest-1").get().to_dict()["qrToken"]
        call(main.check_in_to_event, make_request(data={"questId": "quest-1", "token": token}, uid="user-1", role="user"))

        result = call(main.check_in_to_event, make_request(
            data={"questId": "quest-1", "token": token}, uid="user-1", role="user",
        ))

        assert result["alreadyCheckedIn"] is True
        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["questsAttended"] == 1


class TestPromptReflectsUserProfile:
    def test_different_users_get_prompts_with_their_own_attendance_history(self, fake_firestore, fake_genai, make_request, call):
        # attendedTagCounts (see _record_quest_attended) is what actually
        # feeds the prompt now, not a live scan of the attendance
        # collection — seeding it directly on the user doc is the realistic
        # setup, the same way seed_user already stands in for whatever
        # onboarding/check-in call would have produced it.
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com", attendedTagCounts={"environment": 1})
        seed_user(fake_firestore, "user-2", "Sam", "sam@example.com", attendedTagCounts={"fitness": 1})
        seed_quest(fake_firestore, "quest-1", tags=["environment"])
        fake_genai.queue_response(_recommendations_json([]))

        _trigger_refresh(make_request, call, uid="user-1")
        prompt_1 = fake_genai.last_prompt

        _trigger_refresh(make_request, call, uid="user-2")
        prompt_2 = fake_genai.last_prompt

        # Match the exact "Tags from quests they've completed before,
        # most-attended first: [...]" line, not a bare substring — the
        # candidate quest list itself also mentions "environment" (as
        # quest-1's own tag) regardless of which user is being scored.
        assert "before, most-attended first: ['environment']" in prompt_1
        assert "before, most-attended first: ['fitness']" in prompt_2
        assert "before, most-attended first: ['environment']" not in prompt_2
        assert "before, most-attended first: ['fitness']" not in prompt_1

    def test_most_attended_tag_is_listed_first(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com", attendedTagCounts={"youth": 1, "environment": 4})
        seed_quest(fake_firestore, "quest-1")
        fake_genai.queue_response(_recommendations_json([]))

        _trigger_refresh(make_request, call)

        assert "before, most-attended first: ['environment', 'youth']" in fake_genai.last_prompt

    def test_onboarding_interests_appear_only_as_a_fallback_signal(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com", interests=["environment"])
        seed_quest(fake_firestore, "quest-1")
        fake_genai.queue_response(_recommendations_json([]))

        _trigger_refresh(make_request, call)

        assert "Interests stated at onboarding (fallback only): ['environment']" in fake_genai.last_prompt

    def test_past_attendance_tags_are_included_as_volunteer_activity(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com", attendedTagCounts={"youth": 1})
        seed_quest(fake_firestore, "quest-1")
        fake_genai.queue_response(_recommendations_json([]))

        _trigger_refresh(make_request, call)

        assert "youth" in fake_genai.last_prompt


class TestGracefulDegradation:
    def test_gemini_failure_does_not_fail_the_underlying_update(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_quest(fake_firestore, "quest-1")
        fake_genai.queue_error(RuntimeError("Gemini is down"))

        result = call(main.update_accommodation_needs, make_request(
            data={"accommodationNeeds": ["wheelchair-accessible"]}, uid="user-1", role="user",
        ))

        assert result == {"success": True}
        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["accommodationNeeds"] == ["wheelchair-accessible"]
        assert "recommendedQuestOrder" not in user

    def test_zero_eligible_candidates_does_not_crash(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        # No quests seeded at all.

        result = call(main.update_accommodation_needs, make_request(
            data={"accommodationNeeds": ["wheelchair-accessible"]}, uid="user-1", role="user",
        ))

        assert result == {"success": True}
        assert fake_genai.last_prompt is None  # never even called Gemini


class TestUntrustedResponseHandling:
    def test_unknown_quest_id_in_response_is_dropped(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_quest(fake_firestore, "quest-1")
        fake_genai.queue_response(_recommendations_json([
            {"questId": "quest-1", "reason": "Real candidate."},
            {"questId": "quest-does-not-exist", "reason": "Hallucinated."},
        ]))

        _trigger_refresh(make_request, call)

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["recommendedQuestOrder"] == ["quest-1"]

    def test_side_quests_are_never_offered_or_stored(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_quest(fake_firestore, "org-quest", tags=["environment"])
        seed_quest(fake_firestore, "side-quest", isDefault=True, orgId=None, tier="iron")
        # Even if Gemini somehow returns the side quest's id, it was never
        # offered as a candidate — the fake would only echo it back if our
        # own code had included it in the candidate list, which it must not.
        fake_genai.queue_response(_recommendations_json([
            {"questId": "org-quest", "reason": "Matches."},
            {"questId": "side-quest", "reason": "Should never be trusted."},
        ]))

        _trigger_refresh(make_request, call)

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["recommendedQuestOrder"] == ["org-quest"]
        assert "side-quest" not in (fake_genai.last_prompt or "")


class TestRecurringSeriesExpansion:
    def test_a_series_ranks_expand_to_every_future_occurrence(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_quest(fake_firestore, "occ-1", seriesId="series-1", tags=["environment"])
        seed_quest(fake_firestore, "occ-2", seriesId="series-1", tags=["environment"])
        fake_genai.queue_response(_recommendations_json([{"questId": "occ-1", "reason": "Recurring cleanup."}]))

        _trigger_refresh(make_request, call)

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert set(user["recommendedQuestOrder"]) == {"occ-1", "occ-2"}
        assert user["recommendedQuestReasons"]["occ-1"] == "Recurring cleanup."
        assert user["recommendedQuestReasons"]["occ-2"] == "Recurring cleanup."
