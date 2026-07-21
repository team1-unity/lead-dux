import pytest
from firebase_functions import https_fn

import main
from tests.helpers import seed_user

ONBOARDING_PAYLOAD = {
    "name": "Alex",
    "age": 25,
    "location": "Jersey City, NJ, USA",
    "placeId": "ChIJ_test_place_id",
    "lat": 40.7178,
    "lng": -74.0431,
    "interests": ["community"],
    "experienceLevel": "new",
    "timeAvailability": "weekly",
    "groupPreference": "solo",
    "motivation": "community",
    "leaderGoal": "Build confidence organizing locally.",
}

ORG_REQUEST_PAYLOAD = {
    "name": "Trail Org",
    "phone": "555-0100",
    "location": "Jersey City, NJ, USA",
    "placeId": "ChIJ_test_place_id",
    "reason": "We clean up trails.",
}


class TestSubmitOnboardingLocation:
    def test_requires_place_id(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        data = {**ONBOARDING_PAYLOAD, "placeId": None}

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_onboarding, make_request(data=data, uid="user-1", role="onboarding_user"))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    def test_requires_location(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        data = {**ONBOARDING_PAYLOAD, "location": None}

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_onboarding, make_request(data=data, uid="user-1", role="onboarding_user"))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    def test_stores_location_and_place_id(self, fake_firestore, fake_auth, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        call(main.submit_onboarding, make_request(data=ONBOARDING_PAYLOAD, uid="user-1", role="onboarding_user"))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["location"] == "Jersey City, NJ, USA"
        assert user["placeId"] == "ChIJ_test_place_id"
        assert user["lat"] == 40.7178
        assert user["lng"] == -74.0431

    def test_requires_lat_lng(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        data = {**ONBOARDING_PAYLOAD, "lat": None, "lng": None}

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_onboarding, make_request(data=data, uid="user-1", role="onboarding_user"))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT


class TestSubmitOnboardingAccommodationNeeds:
    def test_defaults_to_empty(self, fake_firestore, fake_auth, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        call(main.submit_onboarding, make_request(data=ONBOARDING_PAYLOAD, uid="user-1", role="onboarding_user"))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["accommodationNeeds"] == []

    def test_stores_a_valid_selection(self, fake_firestore, fake_auth, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        data = {**ONBOARDING_PAYLOAD, "accommodationNeeds": ["wheelchair-accessible", "sensory-friendly"]}

        call(main.submit_onboarding, make_request(data=data, uid="user-1", role="onboarding_user"))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["accommodationNeeds"] == ["wheelchair-accessible", "sensory-friendly"]

    def test_rejects_unknown_value(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")
        data = {**ONBOARDING_PAYLOAD, "accommodationNeeds": ["free-parking"]}

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_onboarding, make_request(data=data, uid="user-1", role="onboarding_user"))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT


class TestSubmitOrganizationRequestLocation:
    def test_requires_place_id(self, fake_firestore, make_request, call):
        data = {**ORG_REQUEST_PAYLOAD, "placeId": None}

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.submit_organization_request, make_request(data=data, uid="org-1", role="onboarding_org"))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    def test_stores_location_and_place_id(self, fake_firestore, fake_auth, make_request, call):
        call(main.submit_organization_request, make_request(
            data=ORG_REQUEST_PAYLOAD, uid="org-1", role="onboarding_org",
        ))

        org_req = fake_firestore.client().collection("ORGREQ").document("org-1").get().to_dict()
        assert org_req["location"] == "Jersey City, NJ, USA"
        assert org_req["placeId"] == "ChIJ_test_place_id"
