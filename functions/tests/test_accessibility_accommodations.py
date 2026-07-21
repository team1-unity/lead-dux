import pytest
from firebase_functions import https_fn

import main
from tests.helpers import seed_quest, seed_user

# NYC-ish coordinates for the user; org quests are seeded either "nearby"
# (a few km away, well within ACCESSIBLE_QUEST_RADIUS_KM) or "far" (the
# opposite side of the globe) to exercise the distance filter without
# depending on exact km math.
USER_LAT, USER_LNG = 40.7128, -74.0060
NEARBY_LAT, NEARBY_LNG = 40.72, -74.01
FAR_LAT, FAR_LNG = -33.8688, 151.2093  # Sydney


def _seed_accommodation_user(fake_firestore, uid="user-1", points=90, needs=("wheelchair-accessible",), **overrides):
    # points=90 -> _points_to_next_rank=10 -> quests_needed=ceil(10/20)=1,
    # so a single matching/nearby org quest is enough to satisfy the check —
    # keeps every test's seed data small.
    defaults = {"points": points, "accommodationNeeds": list(needs), "lat": USER_LAT, "lng": USER_LNG}
    defaults.update(overrides)
    seed_user(fake_firestore, uid, "Alex", "alex@example.com", **defaults)


def _seed_two_active_side_quests(fake_firestore, uid="user-1"):
    seed_quest(fake_firestore, "side-1", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=[uid])
    seed_quest(fake_firestore, "side-2", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=[uid])
    seed_quest(fake_firestore, "side-3", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=[])


class TestSideQuestLimitRelaxation:
    def test_relaxes_when_no_matching_nearby_org_quests_exist(self, fake_firestore, make_request, call):
        _seed_accommodation_user(fake_firestore)
        _seed_two_active_side_quests(fake_firestore)
        # No org quests at all — nothing could possibly satisfy the need.

        result = call(main.rsvp_to_quest, make_request(data={"questId": "side-3"}, uid="user-1", role="user"))

        assert result["success"] is True

    def test_stays_at_limit_when_a_matching_nearby_org_quest_exists(self, fake_firestore, make_request, call):
        _seed_accommodation_user(fake_firestore)
        _seed_two_active_side_quests(fake_firestore)
        seed_quest(
            fake_firestore, "org-quest-1", orgId="org-1", isDefault=False, tier=None, capacity=None, rsvpd=[],
            lat=NEARBY_LAT, lng=NEARBY_LNG, accommodationTags=["wheelchair-accessible"],
        )

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.rsvp_to_quest, make_request(data={"questId": "side-3"}, uid="user-1", role="user"))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_a_matching_quest_too_far_away_does_not_count(self, fake_firestore, make_request, call):
        _seed_accommodation_user(fake_firestore)
        _seed_two_active_side_quests(fake_firestore)
        seed_quest(
            fake_firestore, "org-quest-far", orgId="org-1", isDefault=False, tier=None, capacity=None, rsvpd=[],
            lat=FAR_LAT, lng=FAR_LNG, accommodationTags=["wheelchair-accessible"],
        )

        result = call(main.rsvp_to_quest, make_request(data={"questId": "side-3"}, uid="user-1", role="user"))

        assert result["success"] is True

    def test_a_nearby_quest_missing_the_needed_tag_does_not_count(self, fake_firestore, make_request, call):
        _seed_accommodation_user(fake_firestore)
        _seed_two_active_side_quests(fake_firestore)
        seed_quest(
            fake_firestore, "org-quest-notag", orgId="org-1", isDefault=False, tier=None, capacity=None, rsvpd=[],
            lat=NEARBY_LAT, lng=NEARBY_LNG, accommodationTags=["asl-interpretation"],
        )

        result = call(main.rsvp_to_quest, make_request(data={"questId": "side-3"}, uid="user-1", role="user"))

        assert result["success"] is True

    def test_user_with_no_accommodation_needs_is_unaffected(self, fake_firestore, make_request, call):
        # Explicitly empty (not just absent) — still no relaxation, same as
        # the pre-existing TestRsvpConcurrentSideQuestLimit behavior.
        _seed_accommodation_user(fake_firestore, needs=())
        _seed_two_active_side_quests(fake_firestore)
        # No org quests seeded at all — if this user's accommodationNeeds
        # were mistakenly treated as non-empty, this would incorrectly relax.

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.rsvp_to_quest, make_request(data={"questId": "side-3"}, uid="user-1", role="user"))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_user_already_at_diamond_is_not_relaxed(self, fake_firestore, make_request, call):
        # No rank left to reach — _points_to_next_rank returns None, so
        # there's nothing for the relaxation to be "for".
        _seed_accommodation_user(fake_firestore, points=1000)
        _seed_two_active_side_quests(fake_firestore)

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.rsvp_to_quest, make_request(data={"questId": "side-3"}, uid="user-1", role="user"))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_missing_coordinates_relaxes_generously(self, fake_firestore, make_request, call):
        # Accommodation needs stated but no lat/lng on file (shouldn't
        # happen via real onboarding anymore, but defensive either way) —
        # can't confirm "enough nearby", so this errs generous.
        _seed_accommodation_user(fake_firestore, lat=None, lng=None)
        _seed_two_active_side_quests(fake_firestore)

        result = call(main.rsvp_to_quest, make_request(data={"questId": "side-3"}, uid="user-1", role="user"))

        assert result["success"] is True


class TestGetSideQuestStatusRelaxation:
    def test_reports_no_limit_when_relaxed(self, fake_firestore, make_request, call):
        _seed_accommodation_user(fake_firestore)
        _seed_two_active_side_quests(fake_firestore)

        result = call(main.get_side_quest_status, make_request(uid="user-1", role="user"))

        assert result["atLimit"] is False
        assert result["limit"] is None

    def test_reports_normal_limit_when_not_relaxed(self, fake_firestore, make_request, call):
        _seed_accommodation_user(fake_firestore, needs=())
        _seed_two_active_side_quests(fake_firestore)

        result = call(main.get_side_quest_status, make_request(uid="user-1", role="user"))

        assert result["atLimit"] is True
        assert result["limit"] == main.SIDE_QUEST_CONCURRENT_LIMIT
