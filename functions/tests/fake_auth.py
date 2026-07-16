"""A minimal in-memory stand-in for firebase_admin.auth — just enough of
its surface area (set_custom_user_claims/delete_user/list_users) for
main.py to run against in unit tests without a live Firebase project.
Mirrors fake_firestore.py's approach: not general-purpose, extend as
main.py grows to use more of the real API."""


class FakeAuthUser:
    def __init__(self, uid, email, custom_claims):
        self.uid = uid
        self.email = email
        self.custom_claims = custom_claims


class FakeUserIterator:
    def __init__(self, users):
        self._users = users

    def iterate_all(self):
        return iter(self._users)


class FakeAuthModule:
    def __init__(self):
        self.claims_by_uid = {}
        self.deleted_uids = set()

    def set_custom_user_claims(self, uid, claims):
        self.claims_by_uid[uid] = claims

    def delete_user(self, uid):
        self.deleted_uids.add(uid)

    def list_users(self):
        users = [
            FakeAuthUser(uid, f"{uid}@example.com", claims)
            for uid, claims in self.claims_by_uid.items()
            if uid not in self.deleted_uids
        ]
        return FakeUserIterator(users)
