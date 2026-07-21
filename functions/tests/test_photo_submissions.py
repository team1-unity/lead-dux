import pytest
from firebase_functions import https_fn

import main
from tests.helpers import seed_attendance, seed_blob, seed_photo_submission, seed_quest, seed_user

# Approving a submission awards points to the submitting user, and
# _award_points reads-then-updates their users/{uid} doc — real Firestore
# (like the fake) rejects a transaction.update() against a document that
# doesn't exist yet, so every approve test needs a real user doc seeded
# first, same as check_in_to_event's own points-awarding tests do.


def _submit(fake_firestore, fake_storage, make_request, call, *, quest_id="quest-1", uid="user-1", **blob_overrides):
    storage_path = f"photoSubmissions/{quest_id}_{uid}/1.jpg"
    seed_blob(fake_storage, storage_path, **blob_overrides)
    return call(main.submit_quest_photo, make_request(
        data={"questId": quest_id, "storagePath": storage_path, "contentType": blob_overrides.get("content_type", "image/jpeg")},
        uid=uid, role="user",
    ))


class TestSubmitQuestPhoto:
    def test_org_quest_rejects_with_no_attendance(self, fake_firestore, fake_storage, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            _submit(fake_firestore, fake_storage, make_request, call)

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_side_quest_rejects_without_rsvp(self, fake_firestore, fake_storage, make_request, call):
        # Side/default quests have no QR check-in at all — RSVP is the gate,
        # not attendance.
        seed_quest(fake_firestore, "quest-1", orgId=None, isDefault=True, tier="iron", rsvpd=[])

        with pytest.raises(https_fn.HttpsError) as exc_info:
            _submit(fake_firestore, fake_storage, make_request, call)

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_side_quest_succeeds_with_rsvp_only_no_attendance_needed(self, fake_firestore, fake_storage, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId=None, isDefault=True, tier="iron", rsvpd=["user-1"], title="Talk to a neighbor")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        result = _submit(fake_firestore, fake_storage, make_request, call)

        assert result == {"success": True, "status": "pending"}
        submission = main._photo_submission_ref(fake_firestore.client(), "quest-1", "user-1").get().to_dict()
        assert submission["status"] == "pending"
        assert submission["isDefault"] is True

    def test_succeeds_once_checked_in(self, fake_firestore, fake_storage, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1", title="Trail Cleanup")
        seed_attendance(fake_firestore, "quest-1", "user-1")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        result = _submit(fake_firestore, fake_storage, make_request, call)

        assert result == {"success": True, "status": "pending"}
        submission = main._photo_submission_ref(fake_firestore.client(), "quest-1", "user-1").get().to_dict()
        assert submission["status"] == "pending"
        assert submission["pointsAwarded"] == 0
        assert submission["orgId"] == "org-1"
        assert submission["userName"] == "Alex"
        assert submission["questTitle"] == "Trail Cleanup"

    def test_rejects_second_submission_while_pending(self, fake_firestore, fake_storage, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1")
        _submit(fake_firestore, fake_storage, make_request, call)

        with pytest.raises(https_fn.HttpsError) as exc_info:
            _submit(fake_firestore, fake_storage, make_request, call)

        assert exc_info.value.code == https_fn.FunctionsErrorCode.ALREADY_EXISTS

    def test_rejects_second_submission_while_approved(self, fake_firestore, fake_storage, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1")
        seed_photo_submission(fake_firestore, "quest-1", "user-1", status="approved")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            _submit(fake_firestore, fake_storage, make_request, call)

        assert exc_info.value.code == https_fn.FunctionsErrorCode.ALREADY_EXISTS

    def test_allows_resubmission_after_rejection(self, fake_firestore, fake_storage, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1")
        seed_photo_submission(
            fake_firestore, "quest-1", "user-1",
            status="rejected", rejectionReason="Blurry photo", createdAt="original-timestamp",
        )

        result = _submit(fake_firestore, fake_storage, make_request, call)

        assert result == {"success": True, "status": "pending"}
        submission = main._photo_submission_ref(fake_firestore.client(), "quest-1", "user-1").get().to_dict()
        assert submission["status"] == "pending"
        assert submission["rejectionReason"] is None
        assert submission["createdAt"] == "original-timestamp"

    def test_rejects_invalid_content_type(self, fake_firestore, fake_storage, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_quest_photo, make_request(
                data={
                    "questId": "quest-1",
                    "storagePath": "photoSubmissions/quest-1_user-1/1.pdf",
                    "contentType": "application/pdf",
                },
                uid="user-1", role="user",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    def test_rejects_oversized_blob(self, fake_firestore, fake_storage, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            _submit(fake_firestore, fake_storage, make_request, call, size=main.MAX_PHOTO_SIZE_BYTES + 1)

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT
        blob = fake_storage.bucket().blob(f"photoSubmissions/quest-1_user-1/1.jpg")
        assert not blob.exists()

    def test_rejects_spoofed_storage_path(self, fake_firestore, fake_storage, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1")
        seed_blob(fake_storage, "photoSubmissions/quest-1_someone-else/1.jpg")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_quest_photo, make_request(
                data={
                    "questId": "quest-1",
                    "storagePath": "photoSubmissions/quest-1_someone-else/1.jpg",
                    "contentType": "image/jpeg",
                },
                uid="user-1", role="user",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    def test_points_not_awarded_while_pending(self, fake_firestore, fake_storage, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_attendance(fake_firestore, "quest-1", "user-1")

        _submit(fake_firestore, fake_storage, make_request, call)

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert (user or {}).get("points", 0) == 0


def _approve(fake_firestore, make_request, call, *, quest_id="quest-1", user_id="user-1", uid="org-1", role="organization"):
    return call(main.approve_photo_submission, make_request(
        data={"questId": quest_id, "userId": user_id}, uid=uid, role=role,
    ))


def _reject(fake_firestore, make_request, call, *, quest_id="quest-1", user_id="user-1", uid="org-1", role="organization", reason=None):
    return call(main.reject_photo_submission, make_request(
        data={"questId": quest_id, "userId": user_id, "reason": reason}, uid=uid, role=role,
    ))


class TestApprovePhotoSubmission:
    def test_owning_org_approves_and_awards_points(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_photo_submission(fake_firestore, "quest-1", "user-1")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        result = _approve(fake_firestore, make_request, call)

        assert result == {"success": True}
        submission = main._photo_submission_ref(fake_firestore.client(), "quest-1", "user-1").get().to_dict()
        assert submission["status"] == "approved"
        assert submission["pointsAwarded"] == main.PHOTO_BONUS_POINTS
        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["points"] == main.PHOTO_BONUS_POINTS

    def test_admin_approves_a_side_quest_submission_awards_exactly_tier_points_and_creates_attendance(
        self, fake_firestore, make_request, call,
    ):
        # Side quests have no QR check-in — approving the photo IS the
        # completion moment, so it awards exactly the tier's base points
        # (no separate +5 photo bonus stacked on top — that bonus is
        # organization-quest-only), and creates the attendance doc that
        # frees this quest's SIDE_QUEST_CONCURRENT_LIMIT slot.
        seed_quest(fake_firestore, "quest-1", orgId=None, isDefault=True, tier="bronze", rsvpd=["user-1"])
        seed_photo_submission(fake_firestore, "quest-1", "user-1", orgId=None, isDefault=True)
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        result = _approve(fake_firestore, make_request, call, uid="admin-1", role="admin")

        assert result == {"success": True}
        submission = main._photo_submission_ref(fake_firestore.client(), "quest-1", "user-1").get().to_dict()
        assert submission["status"] == "approved"
        assert submission["pointsAwarded"] == main.TIER_BASE_POINTS["bronze"]
        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["points"] == main.TIER_BASE_POINTS["bronze"]
        attendance = main._attendance_ref(fake_firestore.client(), "quest-1", "user-1").get().to_dict()
        assert attendance is not None
        assert attendance["pointsAwarded"] == main.TIER_BASE_POINTS["bronze"]

    def test_org_quest_approval_awards_only_the_photo_bonus(self, fake_firestore, make_request, call):
        # Organization quests already award their points at check-in — photo
        # approval should never also create an attendance doc or award tier
        # points (there's no tier for an org quest anyway).
        seed_quest(fake_firestore, "quest-1", orgId="org-1", isDefault=False)
        seed_photo_submission(fake_firestore, "quest-1", "user-1")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        _approve(fake_firestore, make_request, call)

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["points"] == main.PHOTO_BONUS_POINTS
        assert not main._attendance_ref(fake_firestore.client(), "quest-1", "user-1").get().exists

    def test_side_quest_already_checked_in_does_not_double_award_tier_points(self, fake_firestore, make_request, call):
        # Edge case: an admin generated a QR for this side quest and the
        # user already checked in through it (tier points already awarded
        # there) before also getting their photo approved — approval should
        # award nothing further, not even a bonus (side quests have none).
        seed_quest(fake_firestore, "quest-1", orgId=None, isDefault=True, tier="gold", rsvpd=["user-1"])
        seed_attendance(fake_firestore, "quest-1", "user-1", orgId=None, pointsAwarded=main.TIER_BASE_POINTS["gold"])
        seed_photo_submission(fake_firestore, "quest-1", "user-1", orgId=None, isDefault=True)
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com", points=main.TIER_BASE_POINTS["gold"])

        _approve(fake_firestore, make_request, call, uid="admin-1", role="admin")

        submission = main._photo_submission_ref(fake_firestore.client(), "quest-1", "user-1").get().to_dict()
        assert submission["pointsAwarded"] == 0
        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["points"] == main.TIER_BASE_POINTS["gold"]

    def test_non_owning_org_is_rejected(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_photo_submission(fake_firestore, "quest-1", "user-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            _approve(fake_firestore, make_request, call, uid="org-2")

        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED

    def test_approving_twice_only_awards_points_once(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_photo_submission(fake_firestore, "quest-1", "user-1")
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        _approve(fake_firestore, make_request, call)

        with pytest.raises(https_fn.HttpsError) as exc_info:
            _approve(fake_firestore, make_request, call)

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION
        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["points"] == main.PHOTO_BONUS_POINTS


class TestRejectPhotoSubmission:
    def test_owning_org_rejects_with_a_reason(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_photo_submission(fake_firestore, "quest-1", "user-1")

        result = _reject(fake_firestore, make_request, call, reason="Blurry photo")

        assert result == {"success": True}
        submission = main._photo_submission_ref(fake_firestore.client(), "quest-1", "user-1").get().to_dict()
        assert submission["status"] == "rejected"
        assert submission["rejectionReason"] == "Blurry photo"
        assert submission["pointsAwarded"] == 0
        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert (user or {}).get("points", 0) == 0

    def test_rejecting_an_approved_submission_fails(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_photo_submission(fake_firestore, "quest-1", "user-1", status="approved", pointsAwarded=main.PHOTO_BONUS_POINTS)

        with pytest.raises(https_fn.HttpsError) as exc_info:
            _reject(fake_firestore, make_request, call)

        assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION

    def test_non_owning_org_is_rejected(self, fake_firestore, make_request, call):
        seed_quest(fake_firestore, "quest-1", orgId="org-1")
        seed_photo_submission(fake_firestore, "quest-1", "user-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            _reject(fake_firestore, make_request, call, uid="org-2")

        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED
