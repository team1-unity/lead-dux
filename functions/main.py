from firebase_functions import https_fn
from firebase_functions.options import set_global_options
from firebase_admin import auth, firestore, initialize_app

# For cost control, you can set the maximum number of containers that can be
# running at the same time. This helps mitigate the impact of unexpected
# traffic spikes by instead downgrading performance. This limit is a per-function
# limit. You can override the limit for each function using the max_instances
# parameter in the decorator, e.g. @https_fn.on_request(max_instances=5).
set_global_options(max_instances=10)

initialize_app()

ASSIGNABLE_ROLES = {"public", "pendingorg", "organization", "admin"}


def _require_auth(req: https_fn.CallableRequest):
    if req.auth is None:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            "You must be signed in to call this function.",
        )


def _require_admin(req: https_fn.CallableRequest):
    _require_auth(req)
    if req.auth.token.get("role") != "admin":
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            "Only admins can do this.",
        )


# Callable from the frontend with httpsCallable(functions, "set_user_role").
# This is the flexible, dangerous path — the frontend can never set its own
# custom claims, only ask this function to do it, and this function only
# obeys admins. Used both for manual corrections and by the admin
# dashboard's "assign role" control.
@https_fn.on_call()
def set_user_role(req: https_fn.CallableRequest) -> dict:
    _require_admin(req)

    target_uid = req.data.get("targetUid")
    role = req.data.get("role")

    if not target_uid or role not in ASSIGNABLE_ROLES:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"role must be one of {sorted(ASSIGNABLE_ROLES)} and targetUid is required.",
        )

    if role == "public":
        # Clearing claims entirely is how a "public" user is represented —
        # no claim at all, rather than a claim that says role=public. Keeps
        # the token payload small, per Firebase's own guidance.
        auth.set_custom_user_claims(target_uid, None)
    else:
        auth.set_custom_user_claims(target_uid, {"role": role})

    return {"success": True, "targetUid": target_uid, "role": role}


# Callable from the frontend right after Firebase Auth account creation, for
# BOTH signup paths — this is the one place "what does a brand-new account
# become" gets decided, so the admin-allowlist check only has to live in one
# spot. Takes intent: "public" | "organization" plus that path's form fields.
@https_fn.on_call()
def complete_signup(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)

    uid = req.auth.uid
    email = (req.auth.token.get("email") or "").lower()
    db = firestore.client()

    # Admin allowlist wins regardless of what the signup form said — someone
    # on this list becomes admin even if they went through the org signup
    # form by mistake. The list itself is never client-writable (see
    # firestore.rules); it's maintained by hand in the Firebase Console.
    admins_doc = db.collection("config").document("admins").get()
    admin_emails = set(admins_doc.to_dict().get("emails", [])) if admins_doc.exists else set()
    if email in admin_emails:
        auth.set_custom_user_claims(uid, {"role": "admin"})
        return {"success": True, "role": "admin"}

    intent = req.data.get("intent")

    if intent == "organization":
        name = req.data.get("name")
        phone = req.data.get("phone")
        location = req.data.get("location")
        reason = req.data.get("reason")

        if not all([name, phone, location, reason]):
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                "name, phone, location, and reason are required.",
            )

        auth.set_custom_user_claims(uid, {"role": "pendingorg"})
        db.collection("ORGREQ").document(uid).set({
            "name": name,
            "email": email,
            "phone": phone,
            "location": location,
            "reason": reason,
            "status": "pending",
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
        return {"success": True, "role": "pendingorg"}

    if intent == "public":
        db.collection("users").document(uid).set({
            "email": email,
            "name": req.data.get("name"),
            "age": None,
            "interests": [],
            "onboardingComplete": False,
            "isSuspended": False,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        # No claim set at all — absence of a role claim is how "public" is
        # represented, same convention set_user_role uses.
        return {"success": True, "role": "public"}

    raise https_fn.HttpsError(
        https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
        'intent must be "public" or "organization".',
    )


# Callable from the onboarding (interests) form, once, right after a public
# user answers it. Writes to the caller's own doc only — there's no
# targetUid here, unlike set_user_role, so there's nothing to escalate.
@https_fn.on_call()
def submit_onboarding(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)

    interests = req.data.get("interests")
    age = req.data.get("age")
    name = req.data.get("name")

    if not isinstance(interests, list) or not interests:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "interests must be a non-empty list.",
        )

    firestore.client().collection("users").document(req.auth.uid).update({
        "name": name,
        "age": age,
        "interests": interests,
        "onboardingComplete": True,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    return {"success": True}


# Callable from the admin dashboard's "pending organization requests" list.
# Admin-gated for the same reason set_user_role is: it can grant a role to
# an arbitrary uid, so it can't be left open to just anyone.
@https_fn.on_call()
def approve_organization(req: https_fn.CallableRequest) -> dict:
    _require_admin(req)

    target_uid = req.data.get("targetUid")
    if not target_uid:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "targetUid is required.",
        )

    db = firestore.client()
    req_ref = db.collection("ORGREQ").document(target_uid)
    req_snap = req_ref.get()
    if not req_snap.exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND,
            f"No ORGREQ found for {target_uid}.",
        )

    request_data = req_snap.to_dict()
    db.collection("organizations").document(target_uid).set({
        "name": request_data.get("name"),
        "email": request_data.get("email"),
        "phone": request_data.get("phone"),
        "location": request_data.get("location"),
        "reason": request_data.get("reason"),
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    req_ref.update({"status": "approved"})
    auth.set_custom_user_claims(target_uid, {"role": "organization"})

    return {"success": True, "targetUid": target_uid, "role": "organization"}


# Callable from the admin dashboard's "all users" list. The client Firebase
# SDK has no way to enumerate accounts at all — auth.list_users() only
# exists in the Admin SDK — so this has to be a Cloud Function, admin-gated
# the same way every other admin-only action here is.
@https_fn.on_call()
def admin_list_users(req: https_fn.CallableRequest) -> dict:
    _require_admin(req)

    users = []
    for user in auth.list_users().iterate_all():
        claims = user.custom_claims or {}
        users.append({
            "uid": user.uid,
            "email": user.email,
            "role": claims.get("role", "public"),
        })
        if len(users) >= 1000:
            break

    return {"users": users}
