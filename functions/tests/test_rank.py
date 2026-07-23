import datetime as dt

import pytest
from firebase_functions import https_fn

import main
from tests.helpers import seed_quest, seed_user


class TestRankForPoints:
    @pytest.mark.parametrize(
        "points,expected",
        [
            (0, "Iron"),
            (99, "Iron"),
            (100, "Bronze"),
            (250, "Silver"),
            (399, "Gold"),
            (400, "Diamond"),
            (10_000, "Diamond"),
            (-5, "Iron"),
        ],
    )
    def test_thresholds(self, points, expected):
        assert main._rank_for_points(points) == expected

    def test_points_to_next_rank_counts_down_to_threshold(self):
        assert main._points_to_next_rank(0) == 100
        assert main._points_to_next_rank(80) == 20
        assert main._points_to_next_rank(100) == 100

    def test_points_to_next_rank_is_none_at_diamond(self):
        assert main._points_to_next_rank(400) is None


class TestCheckInToEventAwardsPoints:
    def test_org_quest_awards_flat_points_and_sets_rank(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", rsvpd=["user-1"], orgId="org-1", qrToken="good-token", qrTokenVersion=0)
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        call(main.check_in_to_event, make_request(
            data={"questId": "quest-1", "token": "good-token"},
            uid="user-1", role="user",
        ))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["points"] == main.ORG_QUEST_BASE_POINTS
        assert user["rank"] == "Iron"

    @pytest.mark.parametrize("tier,expected_points", [
        ("iron", 10), ("bronze", 12), ("silver", 15), ("gold", 18), ("diamond", 20),
    ])
    def test_side_quest_awards_tiered_points(self, fake_firestore, make_request, call, tier, expected_points):
        seed_quest(
            fake_firestore, "quest-1", rsvpd=["user-1"], orgId=None, isDefault=True, tier=tier,
            qrToken="good-token", qrTokenVersion=0,
        )
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        call(main.check_in_to_event, make_request(
            data={"questId": "quest-1", "token": "good-token"},
            uid="user-1", role="user",
        ))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["points"] == expected_points

    def test_side_quest_with_no_tier_on_file_awards_nothing(self, fake_firestore, make_request, call):
        # Predates the tier field — no migration backfill, so this stays 0.
        seed_quest(
            fake_firestore, "quest-1", rsvpd=["user-1"], orgId=None, isDefault=True,
            qrToken="good-token", qrTokenVersion=0,
        )
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        call(main.check_in_to_event, make_request(
            data={"questId": "quest-1", "token": "good-token"},
            uid="user-1", role="user",
        ))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user.get("points", 0) == 0

    def test_rank_updates_as_points_accumulate_across_checkins(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        for i in range(6):
            seed_quest(
                fake_firestore, f"quest-{i}", rsvpd=["user-1"], orgId="org-1",
                qrToken="t", qrTokenVersion=0,
            )
            call(main.check_in_to_event, make_request(
                data={"questId": f"quest-{i}", "token": "t"},
                uid="user-1", role="user",
            ))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["points"] == 120
        assert user["rank"] == "Bronze"


class TestCreateDefaultQuestTierValidation:
    def _base_data(self, **overrides):
        data = {
            "title": "Talk to a neighbor",
            "description": "Say hi to someone new nearby.",
            "eventDate": dt.datetime.now(dt.timezone.utc).isoformat(),
            "timezone": "UTC",
        }
        data.update(overrides)
        return data

    def test_missing_tier_is_rejected(self, fake_firestore, make_request, call):
        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.create_default_quest, make_request(
                data=self._base_data(), uid="admin-1", role="admin",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    def test_invalid_tier_is_rejected(self, fake_firestore, make_request, call):
        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.create_default_quest, make_request(
                data=self._base_data(tier="platinum"), uid="admin-1", role="admin",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    def test_valid_tier_is_persisted(self, fake_firestore, make_request, call):
        result = call(main.create_default_quest, make_request(
            data=self._base_data(tier="gold"), uid="admin-1", role="admin",
        ))
        quest = fake_firestore.client().collection("quests").document(result["questId"]).get().to_dict()
        assert quest["tier"] == "gold"


class TestGetUserRank:
    def test_self_lookup(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        fake_firestore.client().collection("users").document("user-1").update({"points": 150})

        result = call(main.get_user_rank, make_request(uid="user-1", role="user"))

        assert result == {"points": 150, "rank": "Bronze", "pointsToNextRank": 50}

    def test_non_admin_cannot_look_up_someone_else(self, fake_firestore, make_request, call):
        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.get_user_rank, make_request(
                data={"targetUid": "user-2"}, uid="user-1", role="user",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED

    def test_admin_can_look_up_someone_else(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        fake_firestore.client().collection("users").document("user-1").update({"points": 500})

        result = call(main.get_user_rank, make_request(
            data={"targetUid": "user-1"}, uid="admin-1", role="admin",
        ))

        assert result["rank"] == "Diamond"
        assert result["pointsToNextRank"] is None


class TestListDiamondUsers:
    def test_only_returns_diamond_rank_users(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        seed_user(fake_firestore, "user-2", "Bo", "bo@example.com")
        fake_firestore.client().collection("users").document("user-1").update({"points": 500, "rank": "Diamond"})
        fake_firestore.client().collection("users").document("user-2").update({"points": 50, "rank": "Iron"})

        result = call(main.list_diamond_users, make_request(uid="admin-1", role="admin"))

        uids = {u["uid"] for u in result["users"]}
        assert uids == {"user-1"}

    def test_requires_admin(self, fake_firestore, make_request, call):
        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.list_diamond_users, make_request(uid="user-1", role="user"))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED


class TestIssueCertificate:
    def test_requires_diamond_rank(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        fake_firestore.client().collection("users").document("user-1").update({"points": 50})

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.issue_certificate, make_request(
                data={"targetUid": "user-1"}, uid="admin-1", role="admin",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_requires_admin(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        fake_firestore.client().collection("users").document("user-1").update({"points": 500})

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.issue_certificate, make_request(
                data={"targetUid": "user-1"}, uid="user-1", role="user",
            ))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED

    def test_issues_and_is_idempotent(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        fake_firestore.client().collection("users").document("user-1").update({"points": 500})

        call(main.issue_certificate, make_request(data={"targetUid": "user-1"}, uid="admin-1", role="admin"))
        first = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert first["certificateIssued"] is True
        first_issued_at = first["certificateIssuedAt"]

        call(main.issue_certificate, make_request(data={"targetUid": "user-1"}, uid="admin-1", role="admin"))
        second = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert second["certificateIssuedAt"] == first_issued_at
