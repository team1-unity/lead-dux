import pytest
from firebase_functions import https_fn

import main
from tests.helpers import seed_org, seed_user


class TestMarkIntroSeen:
    def test_leader_writes_to_their_own_user_doc(self, fake_firestore, make_request, call):
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        result = call(main.mark_intro_seen, make_request(uid="user-1", role="user"))

        assert result == {"success": True}
        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["introSeen"] is True

    def test_pending_org_writes_to_their_own_user_doc(self, fake_firestore, make_request, call):
        # pending_org sees the same leader interface as 'user' while waiting
        # on approval (see BottomNav.jsx's role maps) — same collection.
        seed_user(fake_firestore, "user-1", "Alex", "alex@example.com")

        call(main.mark_intro_seen, make_request(uid="user-1", role="pending_org"))

        user = fake_firestore.client().collection("users").document("user-1").get().to_dict()
        assert user["introSeen"] is True

    def test_organization_writes_to_their_own_organization_doc(self, fake_firestore, make_request, call):
        seed_org(fake_firestore, "org-1")

        result = call(main.mark_intro_seen, make_request(uid="org-1", role="organization"))

        assert result == {"success": True}
        org = fake_firestore.client().collection("organizations").document("org-1").get().to_dict()
        assert org["introSeen"] is True

    def test_requires_auth(self, fake_firestore, make_request, call):
        with pytest.raises(https_fn.HttpsError) as exc_info:
            call(main.mark_intro_seen, make_request(authenticated=False))
        assert exc_info.value.code == https_fn.FunctionsErrorCode.UNAUTHENTICATED
