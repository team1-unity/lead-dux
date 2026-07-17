import pytest
from firebase_functions import https_fn

import main
from tests.helpers import seed_attendance, seed_quest, seed_user


def _set_points(fake_firestore, uid, points):
    fake_firestore.client().collection("users").document(uid).update({"points": points})


class TestRsvpTierGating:
    def test_rejects_rsvp_to_a_tier_above_the_users_rank(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId=None, isDefault=True, tier="bronze", capacity=None, rsvpd=[])
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        _set_points(fake_firestore, "user-1", 0)  # Iron

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.rsvp_to_quest, make_request(data={"questId": "quest-1"}, uid="user-1", role="user"))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_allows_rsvp_once_rank_unlocks_the_tier(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId=None, isDefault=True, tier="bronze", capacity=None, rsvpd=[])
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        _set_points(fake_firestore, "user-1", 100)  # Bronze

        result = call(main.rsvp_to_quest, make_request(data={"questId": "quest-1"}, uid="user-1", role="user"))
        assert result["success"] is True

    def test_higher_rank_still_unlocks_lower_tiers(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=[])
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        _set_points(fake_firestore, "user-1", 500)  # Diamond

        result = call(main.rsvp_to_quest, make_request(data={"questId": "quest-1"}, uid="user-1", role="user"))
        assert result["success"] is True

    def test_organization_quests_are_never_tier_gated(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1", isDefault=False, tier=None, capacity=None, rsvpd=[])
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        _set_points(fake_firestore, "user-1", 0)  # Iron

        result = call(main.rsvp_to_quest, make_request(data={"questId": "quest-1"}, uid="user-1", role="user"))
        assert result["success"] is True


class TestRsvpConcurrentSideQuestLimit:
    def test_rejects_a_third_active_side_quest(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=["user-1"])
        seed_quest(fake_firestore, "quest-2", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=["user-1"])
        seed_quest(fake_firestore, "quest-3", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=[])
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.rsvp_to_quest, make_request(data={"questId": "quest-3"}, uid="user-1", role="user"))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_allows_a_second_active_side_quest(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=["user-1"])
        seed_quest(fake_firestore, "quest-2", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=[])
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        result = call(main.rsvp_to_quest, make_request(data={"questId": "quest-2"}, uid="user-1", role="user"))
        assert result["success"] is True

    def test_re_rsvping_to_an_already_active_one_is_not_blocked(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=["user-1"])
        seed_quest(fake_firestore, "quest-2", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=["user-1"])
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        # Retried/duplicate RSVP to one of the two already-active quests —
        # must not get rejected as "at the limit".
        result = call(main.rsvp_to_quest, make_request(data={"questId": "quest-1"}, uid="user-1", role="user"))
        assert result["success"] is True

    def test_completing_one_frees_a_slot(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=["user-1"])
        seed_quest(fake_firestore, "quest-2", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=["user-1"])
        seed_quest(fake_firestore, "quest-3", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=[])
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_attendance(fake_firestore, "quest-1", "user-1")  # checked in — no longer "active"

        result = call(main.rsvp_to_quest, make_request(data={"questId": "quest-3"}, uid="user-1", role="user"))
        assert result["success"] is True

    def test_cancelling_one_frees_a_slot(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=["user-1"])
        seed_quest(fake_firestore, "quest-2", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=["user-1"])
        seed_quest(fake_firestore, "quest-3", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=[])
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        call(main.cancel_rsvp, make_request(data={"questId": "quest-1"}, uid="user-1", role="user"))
        result = call(main.rsvp_to_quest, make_request(data={"questId": "quest-3"}, uid="user-1", role="user"))
        assert result["success"] is True

    def test_organization_quest_rsvp_is_never_limited_by_side_quest_count(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=["user-1"])
        seed_quest(fake_firestore, "quest-2", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=["user-1"])
        seed_quest(fake_firestore, "org-quest", orgId="org-1", isDefault=False, tier=None, capacity=None, rsvpd=[])
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        result = call(main.rsvp_to_quest, make_request(data={"questId": "org-quest"}, uid="user-1", role="user"))
        assert result["success"] is True


class TestGetSideQuestStatus:
    def test_reports_unlocked_tiers_for_rank(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        _set_points(fake_firestore, "user-1", 250)  # Silver

        result = call(main.get_side_quest_status, make_request(uid="user-1", role="user"))
        assert result["unlockedTiers"] == ["iron", "bronze", "silver"]

    def test_new_user_with_no_points_unlocks_only_iron(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        result = call(main.get_side_quest_status, make_request(uid="user-1", role="user"))
        assert result["unlockedTiers"] == ["iron"]

    def test_reports_active_ids_and_at_limit(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=["user-1"])
        seed_quest(fake_firestore, "quest-2", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=["user-1"])
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        result = call(main.get_side_quest_status, make_request(uid="user-1", role="user"))
        assert sorted(result["activeSideQuestIds"]) == ["quest-1", "quest-2"]
        assert result["limit"] == 2
        assert result["atLimit"] is True

    def test_completed_side_quest_is_not_counted_as_active(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId=None, isDefault=True, tier="iron", capacity=None, rsvpd=["user-1"])
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_attendance(fake_firestore, "quest-1", "user-1")

        result = call(main.get_side_quest_status, make_request(uid="user-1", role="user"))
        assert result["activeSideQuestIds"] == []
        assert result["atLimit"] is False

    def test_requires_user_role(self, fake_firestore, make_request, call):
        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.get_side_quest_status, make_request(uid="org-1", role="organization"))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED
