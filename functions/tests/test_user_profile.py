import pytest
from firebase_functions import https_fn

import main
from tests.helpers import seed_user


class TestUpdateUserProfile:
    def test_updates_name(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Old Name", "user@example.com")

        result = call(main.update_user_profile, make_request(data={"name": "New Name"}, uid="user-1", role="user"))

        assert result["success"] is True
        assert fake_firestore.client().collection("users").document("user-1").get().to_dict()["name"] == "New Name"

    def test_accepts_a_whitelisted_duck_skin(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        result = call(main.update_user_profile, make_request(data={"duckSkin": "duck2"}, uid="user-1", role="user"))

        assert result["success"] is True
        assert (
            fake_firestore.client().collection("users").document("user-1").get().to_dict()["duckSkin"] == "duck2"
        )

    def test_rejects_an_unknown_duck_skin(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.update_user_profile, make_request(data={"duckSkin": "duck99"}, uid="user-1", role="user"))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT

    def test_updates_name_and_duck_skin_together(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        result = call(
            main.update_user_profile,
            make_request(data={"name": "Alexis", "duckSkin": "duck3"}, uid="user-1", role="user"),
        )

        assert result["success"] is True
        doc = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert doc["name"] == "Alexis"
        assert doc["duckSkin"] == "duck3"

    def test_requires_at_least_one_field(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.update_user_profile, make_request(data={}, uid="user-1", role="user"))

        assert exc_info.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT
