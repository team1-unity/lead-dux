import sys
from pathlib import Path

import pytest

# Make `import main` work regardless of the directory pytest is invoked
# from — main.py lives one level up from this tests/ package.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main as main_module  # noqa: E402
from tests.fake_firestore import FakeFirestoreModule  # noqa: E402


class FakeAuthContext:
    def __init__(self, uid, role):
        self.uid = uid
        self.token = {"role": role}


class FakeCallableRequest:
    """Stands in for firebase_functions.https_fn.CallableRequest. main.py
    only ever reads .data (a dict) and .auth.uid/.auth.token.get(...), so
    that's all this needs to provide."""

    def __init__(self, data=None, uid=None, role=None, authenticated=True):
        self.data = data or {}
        self.auth = FakeAuthContext(uid, role) if authenticated else None


@pytest.fixture
def fake_firestore(monkeypatch):
    """Swaps the `firestore` name main.py imported from firebase_admin for
    an in-memory fake, so calling e.g. main.rsvp_to_quest(...) in a test
    reads/writes the fake store instead of needing a real Firestore
    connection. Fresh store per test — nothing persists between tests."""
    fake_module = FakeFirestoreModule()
    monkeypatch.setattr(main_module, "firestore", fake_module)
    return fake_module


@pytest.fixture
def make_request():
    return FakeCallableRequest


def invoke(func, request):
    """Calls a function decorated with @https_fn.on_call() directly with a
    CallableRequest, bypassing the Flask request-parsing layer on_call()
    wraps it in (that layer expects a real Flask Request and a live app
    context, neither of which exist in a unit test). functools.wraps is
    applied twice between the exported name and the actual business logic
    — once by on_call() itself, once by the CORS decorator underneath it —
    so the original function sits two hops down the __wrapped__ chain."""
    return func.__wrapped__.__wrapped__(request)


@pytest.fixture
def call():
    return invoke
