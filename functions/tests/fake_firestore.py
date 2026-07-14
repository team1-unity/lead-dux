"""A minimal in-memory stand-in for google.cloud.firestore.

Just enough of the real client's surface area (documents, subcollections,
.set/.update/.delete, .where/.stream, ArrayUnion/ArrayRemove,
SERVER_TIMESTAMP) for functions/main.py to run against in unit tests
without a running Firestore emulator. Not a general-purpose fake — extend
it as main.py grows to use more of the real API.

Documents are stored in one flat dict keyed by their full path tuple, e.g.
("quests", "quest-1", "attendance", "user-1") for a doc nested two
collections deep. Querying a collection just means "every stored path that
is exactly one segment longer than this collection's path" — that's what
keeps subcollection queries from also matching their parent or sibling
collections without any extra bookkeeping.
"""

import datetime
import uuid


class ArrayUnion:
    def __init__(self, values):
        self.values = values


class ArrayRemove:
    def __init__(self, values):
        self.values = values


SERVER_TIMESTAMP = object()


def _resolve(value):
    if value is SERVER_TIMESTAMP:
        return datetime.datetime.now(datetime.timezone.utc)
    return value


class FakeDocSnapshot:
    def __init__(self, doc_id, data, reference=None):
        self.id = doc_id
        self._data = data
        # Real DocumentSnapshot.reference points back at the DocumentReference
        # it came from — used by callers that stream() a query and then
        # want to delete/update the doc they just read (see _delete_quest's
        # cascade). Optional because rebuilding FakeDocRef.get()'s own
        # snapshot doesn't need it.
        self.reference = reference

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class FakeDocRef:
    def __init__(self, store, path):
        self._store = store
        self.path = path
        self.id = path[-1]

    def get(self, transaction=None):
        # `transaction` is accepted (and ignored) so code that reads inside
        # a transaction — `ref.get(transaction=transaction)` — works
        # unchanged; this fake has no real isolation to provide.
        return FakeDocSnapshot(self.id, self._store.get(self.path))

    def set(self, data, merge=False):
        resolved = {k: _resolve(v) for k, v in data.items()}
        if merge and self.path in self._store:
            self._store[self.path].update(resolved)
        else:
            self._store[self.path] = resolved

    def update(self, data):
        current = self._store.get(self.path)
        if current is None:
            raise KeyError(f"No document to update at {self.path}")
        for key, value in data.items():
            if isinstance(value, ArrayUnion):
                existing = list(current.get(key, []))
                for item in value.values:
                    if item not in existing:
                        existing.append(item)
                current[key] = existing
            elif isinstance(value, ArrayRemove):
                existing = list(current.get(key, []))
                current[key] = [item for item in existing if item not in value.values]
            else:
                current[key] = _resolve(value)

    def delete(self):
        self._store.pop(self.path, None)

    def collection(self, name):
        return FakeCollectionRef(self._store, self.path + (name,))


class FakeQuery:
    def __init__(self, store, path, filters, limit=None):
        self._store = store
        self._path = path
        self._filters = filters
        self._limit = limit

    def where(self, field, op, value):
        return FakeQuery(self._store, self._path, self._filters + [(field, op, value)], self._limit)

    def limit(self, count):
        return FakeQuery(self._store, self._path, self._filters, count)

    def stream(self):
        child_len = len(self._path) + 1
        yielded = 0
        for path, data in list(self._store.items()):
            if self._limit is not None and yielded >= self._limit:
                break
            if len(path) != child_len or path[: len(self._path)] != self._path:
                continue
            if all(self._matches(data, f) for f in self._filters):
                yielded += 1
                yield FakeDocSnapshot(path[-1], data, reference=FakeDocRef(self._store, path))

    @staticmethod
    def _matches(data, filt):
        field, op, value = filt
        actual = data.get(field)
        if op == "==":
            return actual == value
        if op == "array_contains":
            return isinstance(actual, list) and value in actual
        raise NotImplementedError(f"Unsupported operator in fake: {op}")


class FakeCollectionRef(FakeQuery):
    def __init__(self, store, path):
        super().__init__(store, path, [])

    def document(self, doc_id=None):
        # Real Firestore auto-generates an ID when .document() is called
        # with none — used by create_quest's `db.collection("quests").document()`.
        if doc_id is None:
            doc_id = uuid.uuid4().hex
        return FakeDocRef(self._store, self._path + (doc_id,))


class FakeTransaction:
    """Real Firestore transactions batch writes and commit atomically on
    success. This fake has no concurrent access to guard against, so reads
    go straight to the store (via FakeDocRef.get's ignored `transaction`
    param) and writes apply immediately instead of being buffered."""

    def set(self, ref, data, merge=False):
        ref.set(data, merge=merge)

    def update(self, ref, data):
        ref.update(data)


def transactional(func):
    # Real firestore.transactional retries `func` on write contention.
    # Nothing in this fake can actually contend, so this is a direct
    # call-through — same signature (transaction first, then *args).
    def wrapper(transaction, *args, **kwargs):
        return func(transaction, *args, **kwargs)

    return wrapper


class FakeBatch:
    """Real WriteBatch buffers operations and applies them atomically on
    .commit(). This fake buffers the same way (rather than applying each
    call immediately like FakeTransaction does) mostly so relying on
    .commit() actually being called is caught by tests, same as it would
    need to be against the real SDK."""

    def __init__(self):
        self._ops = []

    def set(self, ref, data, merge=False):
        self._ops.append((lambda d: ref.set(d, merge=merge), data))

    def update(self, ref, data):
        self._ops.append((ref.update, data))

    def delete(self, ref):
        self._ops.append((lambda _data: ref.delete(), None))

    def commit(self):
        for op, data in self._ops:
            op(data)
        self._ops = []


class FakeFirestoreClient:
    def __init__(self):
        self._store = {}

    def collection(self, name):
        return FakeCollectionRef(self._store, (name,))

    def transaction(self):
        return FakeTransaction()

    def batch(self):
        return FakeBatch()


class FakeFirestoreModule:
    """Substitutes for the `firestore` name main.py imports from
    firebase_admin — main.py calls firestore.client()/.SERVER_TIMESTAMP/
    .ArrayUnion/.ArrayRemove/.transactional, and this provides fakes for
    all of them."""

    SERVER_TIMESTAMP = SERVER_TIMESTAMP
    ArrayUnion = ArrayUnion
    ArrayRemove = ArrayRemove
    transactional = staticmethod(transactional)

    def __init__(self):
        self._client = FakeFirestoreClient()

    def client(self):
        return self._client
