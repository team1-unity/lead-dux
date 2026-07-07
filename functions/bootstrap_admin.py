# Run this once, locally, to create your very first admin — never deployed
# (Firebase only deploys functions decorated with @https_fn, and this has
# none). set_user_role in main.py refuses to grant "admin" unless the caller
# is already an admin, so the first one has to be set directly, outside the
# deployed app, by whoever holds the service account key.
#
# Usage:
#   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
#   python bootstrap_admin.py <uid>
#
# Find the uid in Firebase Console > Authentication > Users (or have the
# person sign up first, then look it up there).

import sys

from firebase_admin import auth, initialize_app

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python bootstrap_admin.py <uid>")
        sys.exit(1)

    initialize_app()
    uid = sys.argv[1]
    auth.set_custom_user_claims(uid, {"role": "admin"})
    print(f"Granted role=admin to uid={uid}")
