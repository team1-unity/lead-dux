"""A minimal in-memory stand-in for firebase_admin.storage (google-cloud-
storage's Bucket/Blob), just enough of the real surface area for
submit_quest_photo's server-side blob re-verification: .bucket().blob(path)
returning an object with .exists()/.reload()/.size/.content_type/.metadata/
.patch()/.delete(). Not a general-purpose fake — extend it as main.py grows
to use more of the real API.
"""


class FakeBlob:
    def __init__(self, bucket, path):
        self._bucket = bucket
        self.name = path
        self.size = None
        self.content_type = None
        self.metadata = None
        self._exists = False

    def exists(self):
        return self._exists

    def reload(self):
        # Real Blob.reload() re-fetches properties from the server — this
        # fake's attributes are already current (set at seed time or by a
        # prior .patch()), so there's nothing to do.
        pass

    def patch(self):
        # Real Blob.patch() pushes locally-changed properties (here, just
        # .metadata) to the server. The fake's .metadata is already "the
        # server's" copy the moment it's assigned, so this is a no-op —
        # tests just assert on blob.metadata directly.
        pass

    def delete(self):
        self._exists = False
        self._bucket._blobs.pop(self.name, None)


class FakeBucket:
    def __init__(self):
        self._blobs = {}

    def blob(self, path):
        if path not in self._blobs:
            self._blobs[path] = FakeBlob(self, path)
        return self._blobs[path]


class FakeStorageModule:
    """Substitutes for the `admin_storage` name main.py imports as
    `from firebase_admin import storage as admin_storage` — main.py only
    ever calls admin_storage.bucket(), so that's all this provides."""

    def __init__(self):
        self._bucket = FakeBucket()

    def bucket(self):
        return self._bucket
