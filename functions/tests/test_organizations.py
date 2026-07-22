import pytest
from firebase_functions import https_fn

import main
from tests.helpers import seed_org


class TestApproveOrganization:
    def test_sets_verified_and_default_profile_fields(self, fake_firestore, fake_auth, make_request, call):
        # No placeId on this ORGREQ doc — simulates a request submitted
        # before Places Autocomplete existed. approve_organization must
        # still work, just carrying forward a None placeId.
        fake_firestore.client().collection("ORGREQ").document("org-1").set({
            "name": "Trail Org",
            "email": "org@example.com",
            "phone": "555-0100",
            "location": "Riverside",
            "reason": "We clean up trails.",
            "status": "pending",
        })

        call(main.approve_organization, make_request(data={"targetUid": "org-1"}, uid="admin-1", role="admin"))

        org = fake_firestore.client().collection("organizations").document("org-1").get().to_dict()
        assert org["verified"] is True
        assert org["reviewCount"] == 0
        assert org["avgRating"] == 0
        assert org["photos"] == []
        assert org["socialLinks"] == {}
        assert org["logoUrl"] is None
        assert org["placeId"] is None

    def test_copies_place_id_from_the_request(self, fake_firestore, fake_auth, make_request, call):
        fake_firestore.client().collection("ORGREQ").document("org-1").set({
            "name": "Trail Org",
            "email": "org@example.com",
            "phone": "555-0100",
            "location": "Riverside",
            "placeId": "ChIJ_test_place_id",
            "reason": "We clean up trails.",
            "status": "pending",
        })

        call(main.approve_organization, make_request(data={"targetUid": "org-1"}, uid="admin-1", role="admin"))

        org = fake_firestore.client().collection("organizations").document("org-1").get().to_dict()
        assert org["placeId"] == "ChIJ_test_place_id"


class TestUpdateOrganizationProfile:
    def test_org_can_set_its_own_profile_fields(self, fake_firestore, make_request, call):
        seed_org(fake_firestore, "org-1")

        result = call(main.update_organization_profile, make_request(
            data={
                "missionStatement": "Keep the trails clean.",
                "city": "Portland",
                "state": "OR",
                "website": "https://example.org",
                "socialLinks": {"instagram": "https://instagram.com/trailorg", "facebook": ""},
            },
            uid="org-1", role="organization",
        ))

        assert result == {"success": True}
        org = fake_firestore.client().collection("organizations").document("org-1").get().to_dict()
        assert org["missionStatement"] == "Keep the trails clean."
        assert org["city"] == "Portland"
        assert org["state"] == "OR"
        assert org["website"] == "https://example.org"
        # Empty-string values are dropped rather than stored as noise.
        assert org["socialLinks"] == {"instagram": "https://instagram.com/trailorg"}

    def test_partial_update_leaves_other_fields_untouched(self, fake_firestore, make_request, call):
        seed_org(fake_firestore, "org-1", city="Portland")

        call(main.update_organization_profile, make_request(
            data={"state": "OR"}, uid="org-1", role="organization",
        ))

        org = fake_firestore.client().collection("organizations").document("org-1").get().to_dict()
        assert org["city"] == "Portland"
        assert org["state"] == "OR"

    def test_rejects_unknown_social_link_keys(self, fake_firestore, make_request, call):
        seed_org(fake_firestore, "org-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.update_organization_profile, make_request(
                data={"socialLinks": {"myspace": "https://myspace.com/trailorg"}},
                uid="org-1", role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    def test_rejects_non_string_field(self, fake_firestore, make_request, call):
        seed_org(fake_firestore, "org-1")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.update_organization_profile, make_request(
                data={"website": 12345}, uid="org-1", role="organization",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    def test_requires_organization_role(self, fake_firestore, make_request, call):
        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.update_organization_profile, make_request(
                data={"city": "Portland"}, uid="user-1", role="user",
            ))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED
