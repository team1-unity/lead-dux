import json

import main
from tests.helpers import seed_attendance, seed_quest, seed_user

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

    def test_update_interests_generates_a_ranking(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com", interests=["environment"])
        seed_quest(fake_firestore, "quest-1", tags=["environment"])
        fake_genai.queue_response(_recommendations_json([{"questId": "quest-1", "reason": "Good fit."}]))

        call(main.update_interests, make_request(data={"interests": ["fitness"]}, uid="user-1", role="user"))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["recommendedQuestOrder"] == ["quest-1"]

    def test_update_accommodation_needs_generates_a_ranking(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_quest(fake_firestore, "quest-1")
        fake_genai.queue_response(_recommendations_json([{"questId": "quest-1", "reason": "Accessible to you."}]))

        call(main.update_accommodation_needs, make_request(
            data={"accommodationNeeds": ["wheelchair-accessible"]}, uid="user-1", role="user",
        ))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["recommendedQuestOrder"] == ["quest-1"]


class TestPromptReflectsUserProfile:
    def test_different_users_get_prompts_with_their_own_data(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com", interests=["environment"])
        seed_user(fake_firestore, "user-2", "Sam", "sam@example.com", interests=["fitness"])
        seed_quest(fake_firestore, "quest-1", tags=["environment"])
        fake_genai.queue_response(_recommendations_json([]))

        call(main.update_interests, make_request(data={"interests": ["environment"]}, uid="user-1", role="user"))
        prompt_1 = fake_genai.last_prompt

        call(main.update_interests, make_request(data={"interests": ["fitness"]}, uid="user-2", role="user"))
        prompt_2 = fake_genai.last_prompt

        # Match the exact "Interests: [...]" line, not a bare substring —
        # the candidate quest list itself also mentions "environment" (as
        # quest-1's own tag) regardless of which user is being scored.
        assert "Interests: ['environment']" in prompt_1
        assert "Interests: ['fitness']" in prompt_2
        assert "Interests: ['environment']" not in prompt_2
        assert "Interests: ['fitness']" not in prompt_1

    def test_past_attendance_tags_are_included_as_volunteer_activity(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_quest(fake_firestore, "past-quest", tags=["youth"])
        seed_attendance(fake_firestore, "past-quest", "user-1")
        seed_quest(fake_firestore, "quest-1")
        fake_genai.queue_response(_recommendations_json([]))

        call(main.update_interests, make_request(data={"interests": ["environment"]}, uid="user-1", role="user"))

        assert "youth" in fake_genai.last_prompt


class TestGracefulDegradation:
    def test_gemini_failure_does_not_fail_the_underlying_update(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_quest(fake_firestore, "quest-1")
        fake_genai.queue_error(RuntimeError("Gemini is down"))

        result = call(main.update_interests, make_request(data={"interests": ["fitness"]}, uid="user-1", role="user"))

        assert result == {"success": True}
        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["interests"] == ["fitness"]
        assert "recommendedQuestOrder" not in user

    def test_zero_eligible_candidates_does_not_crash(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        # No quests seeded at all.

        result = call(main.update_interests, make_request(data={"interests": ["fitness"]}, uid="user-1", role="user"))

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

        call(main.update_interests, make_request(data={"interests": ["fitness"]}, uid="user-1", role="user"))

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

        call(main.update_interests, make_request(data={"interests": ["environment"]}, uid="user-1", role="user"))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["recommendedQuestOrder"] == ["org-quest"]
        assert "side-quest" not in (fake_genai.last_prompt or "")


class TestRecurringSeriesExpansion:
    def test_a_series_ranks_expand_to_every_future_occurrence(self, fake_firestore, fake_genai, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_quest(fake_firestore, "occ-1", seriesId="series-1", tags=["environment"])
        seed_quest(fake_firestore, "occ-2", seriesId="series-1", tags=["environment"])
        fake_genai.queue_response(_recommendations_json([{"questId": "occ-1", "reason": "Recurring cleanup."}]))

        call(main.update_interests, make_request(data={"interests": ["environment"]}, uid="user-1", role="user"))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert set(user["recommendedQuestOrder"]) == {"occ-1", "occ-2"}
        assert user["recommendedQuestReasons"]["occ-1"] == "Recurring cleanup."
        assert user["recommendedQuestReasons"]["occ-2"] == "Recurring cleanup."
