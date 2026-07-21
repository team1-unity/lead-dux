import sys
from pathlib import Path

import pytest

# Make `import main` work regardless of the directory pytest is invoked
# from — main.py lives one level up from this tests/ package.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main as main_module  # noqa: E402
from tests.fake_firestore import FakeFirestoreModule  # noqa: E402
from tests.fake_auth import FakeAuthModule  # noqa: E402
from tests.fake_storage import FakeStorageModule  # noqa: E402


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
def fake_auth(monkeypatch):
    """Swaps the `auth` name main.py imported from firebase_admin for an
    in-memory fake — only needed by tests that exercise a function calling
    auth.set_custom_user_claims/delete_user/list_users (e.g.
    approve_organization, set_user_role), which would otherwise need a real
    initialized Firebase project."""
    fake_module = FakeAuthModule()
    monkeypatch.setattr(main_module, "auth", fake_module)
    return fake_module


@pytest.fixture
def fake_storage(monkeypatch):
    """Swaps the `admin_storage` name main.py imported from firebase_admin
    for an in-memory fake — only needed by submit_quest_photo, which
    re-verifies an uploaded blob's size/content-type via the Admin SDK."""
    fake_module = FakeStorageModule()
    monkeypatch.setattr(main_module, "admin_storage", fake_module)
    return fake_module


class _FakeGenaiResponse:
    def __init__(self, text):
        self.text = text


class _FakeGenaiModels:
    def __init__(self, module):
        self._module = module

    def generate_content(self, *, model, contents, config):
        self._module.last_prompt = contents
        if self._module.error is not None:
            raise self._module.error
        return _FakeGenaiResponse(self._module.queued_response)


class _FakeGenaiClient:
    def __init__(self, module):
        self.models = _FakeGenaiModels(module)


class FakeGenaiModule:
    """Stands in for the `genai` name main.py imported from google.genai
    (`from google import genai`) — lets tests drive Gemini's response (or
    an API failure) without a real network call. Queue a JSON string via
    queue_response(...) before invoking the function under test, or
    queue_error(...) to simulate the API failing; last_prompt captures
    whatever was actually sent, so a test can assert user-specific profile
    data reached the prompt rather than just checking the output."""

    def __init__(self):
        self.queued_response = None
        self.error = None
        self.last_prompt = None

    def queue_response(self, text):
        self.queued_response = text
        self.error = None

    def queue_error(self, error):
        self.error = error

    def Client(self):
        return _FakeGenaiClient(self)


@pytest.fixture
def fake_genai(monkeypatch):
    fake_module = FakeGenaiModule()
    monkeypatch.setattr(main_module, "genai", fake_module)
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
