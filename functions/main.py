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

# The full role state machine:
#   (no claim) -> onboarding_user -> user -> onboarding_org -> pending_org -> organization
# Everyone signs up and onboards the same way; onboarding_org is only
# reached afterward, via Settings (start_organization_onboarding). admin is
# granted out-of-band (config/admins allowlist or set_user_role).
ASSIGNABLE_ROLES = {"onboarding_user", "user", "onboarding_org", "pending_org", "organization", "admin"}


def _require_auth(req: https_fn.CallableRequest):
    if req.auth is None:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            "You must be signed in to call this function.",
        )


def _require_role(req: https_fn.CallableRequest, *roles):
    _require_auth(req)
    if req.auth.token.get("role") not in roles:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            f"This action requires role in {sorted(roles)}.",
        )


def _require_admin(req: https_fn.CallableRequest):
    _require_role(req, "admin")


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

    auth.set_custom_user_claims(target_uid, {"role": role})
    return {"success": True, "targetUid": target_uid, "role": role}


# Callable from the frontend right after Firebase Auth account creation —
# the one and only signup path. Everyone starts as onboarding_user; becoming
# an organization is something a "user" opts into afterward, from Settings
# (see start_organization_onboarding and submit_organization_request below).
@https_fn.on_call()
def complete_signup(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)

    uid = req.auth.uid
    email = (req.auth.token.get("email") or "").lower()
    db = firestore.client()

    # Admin allowlist wins regardless — someone on this list becomes admin
    # the moment they sign up. The list itself is never client-writable (see
    # firestore.rules); it's maintained by hand in the Firebase Console.
    admins_doc = db.collection("config").document("admins").get()
    admin_emails = set(admins_doc.to_dict().get("emails", [])) if admins_doc.exists else set()
    if email in admin_emails:
        auth.set_custom_user_claims(uid, {"role": "admin"})
        return {"success": True, "role": "admin"}

    db.collection("users").document(uid).set({
        "email": email,
        "name": req.data.get("name"),
        "age": None,
        "interests": [],
        "isSuspended": False,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    auth.set_custom_user_claims(uid, {"role": "onboarding_user"})
    return {"success": True, "role": "onboarding_user"}


# Callable from the onboarding (interests) form, once, right after an
# onboarding_user answers it. Writes to the caller's own doc only — there's
# no targetUid here, unlike set_user_role, so there's nothing to escalate.
# Graduates the caller straight to role "user".
@https_fn.on_call()
def submit_onboarding(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "onboarding_user")

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
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    auth.set_custom_user_claims(req.auth.uid, {"role": "user"})
    return {"success": True, "role": "user"}


# Callable from Settings by an already-onboarded "user" who wants to
# register an organization after all. Just flips the state to
# onboarding_org — the same state a brand-new org signup passes through via
# complete_signup — and the org-details form (submit_organization_request)
# takes it from there.
@https_fn.on_call()
def start_organization_onboarding(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "user")
    auth.set_custom_user_claims(req.auth.uid, {"role": "onboarding_org"})
    return {"success": True, "role": "onboarding_org"}


# Callable from the org-details form, for an account currently in
# onboarding_org (reached either via a brand-new org signup or via Settings).
# Creates the pending ORGREQ and graduates the caller to pending_org.
@https_fn.on_call()
def submit_organization_request(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "onboarding_org")

    name = req.data.get("name")
    phone = req.data.get("phone")
    location = req.data.get("location")
    reason = req.data.get("reason")

    if not all([name, phone, location, reason]):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "name, phone, location, and reason are required.",
        )

    uid = req.auth.uid
    email = (req.auth.token.get("email") or "").lower()
    firestore.client().collection("ORGREQ").document(uid).set({
        "name": name,
        "email": email,
        "phone": phone,
        "location": location,
        "reason": reason,
        "status": "pending",
        "createdAt": firestore.SERVER_TIMESTAMP,
    })
    auth.set_custom_user_claims(uid, {"role": "pending_org"})
    return {"success": True, "role": "pending_org"}


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


# Callable from the admin dashboard's "organizations" list. Removes the
# organization's profile and quests, and drops the account back to "user"
# (the underlying Firebase Auth account isn't deleted — just its
# organization status).
@https_fn.on_call()
def delete_organization(req: https_fn.CallableRequest) -> dict:
    _require_admin(req)

    target_uid = req.data.get("targetUid")
    if not target_uid:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "targetUid is required.",
        )

    db = firestore.client()
    db.collection("organizations").document(target_uid).delete()
    for quest_doc in db.collection("quests").where("orgId", "==", target_uid).stream():
        quest_doc.reference.delete()
    auth.set_custom_user_claims(target_uid, {"role": "user"})

    return {"success": True, "targetUid": target_uid}


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
            "role": claims.get("role", "onboarding_user"),
        })
        if len(users) >= 1000:
            break

    return {"users": users}


# Callable from the admin dashboard's "organizations" list.
@https_fn.on_call()
def admin_list_organizations(req: https_fn.CallableRequest) -> dict:
    _require_admin(req)

    orgs = []
    for doc in firestore.client().collection("organizations").stream():
        orgs.append({"uid": doc.id, **doc.to_dict()})
    return {"organizations": orgs}


# Callable from the org dashboard's "create quest" form.
@https_fn.on_call()
def create_quest(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "organization")

    title = req.data.get("title")
    description = req.data.get("description")
    tags = req.data.get("tags") or []

    if not title or not description:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "title and description are required.",
        )

    db = firestore.client()
    org_snap = db.collection("organizations").document(req.auth.uid).get()
    org_name = org_snap.to_dict().get("name") if org_snap.exists else None

    doc_ref = db.collection("quests").document()
    doc_ref.set({
        "title": title,
        "description": description,
        "tags": tags,
        "orgId": req.auth.uid,
        "orgName": org_name,
        "isDefault": False,
        "rsvpd": [],
        "createdAt": firestore.SERVER_TIMESTAMP,
    })
    return {"success": True, "questId": doc_ref.id}


# Callable from the admin dashboard's "add default neighborhood quest" form —
# a quest with no owning organization, shown to everyone.
@https_fn.on_call()
def create_default_quest(req: https_fn.CallableRequest) -> dict:
    _require_admin(req)

    title = req.data.get("title")
    description = req.data.get("description")
    tags = req.data.get("tags") or []

    if not title or not description:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "title and description are required.",
        )

    doc_ref = firestore.client().collection("quests").document()
    doc_ref.set({
        "title": title,
        "description": description,
        "tags": tags,
        "orgId": None,
        "orgName": "Neighborhood",
        "isDefault": True,
        "rsvpd": [],
        "createdAt": firestore.SERVER_TIMESTAMP,
    })
    return {"success": True, "questId": doc_ref.id}


# Callable from the org dashboard (own quests only) and the admin dashboard
# (any quest, including default neighborhood ones).
@https_fn.on_call()
def delete_quest(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)

    quest_id = req.data.get("questId")
    if not quest_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId is required.",
        )

    db = firestore.client()
    ref = db.collection("quests").document(quest_id)
    snap = ref.get()
    if not snap.exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND,
            f"No quest {quest_id}.",
        )

    role = req.auth.token.get("role")
    is_owning_org = role == "organization" and snap.to_dict().get("orgId") == req.auth.uid
    if role != "admin" and not is_owning_org:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            "You can only delete your own organization's quests.",
        )

    ref.delete()
    return {"success": True}


# Callable from the quest list — adds the caller's uid to that quest's
# rsvpd list. Only "user" accounts RSVP; organizations/admins just manage
# or view quests.
@https_fn.on_call()
def rsvp_to_quest(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "user")

    quest_id = req.data.get("questId")
    if not quest_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId is required.",
        )

    ref = firestore.client().collection("quests").document(quest_id)
    if not ref.get().exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND,
            f"No quest {quest_id}.",
        )

    ref.update({"rsvpd": firestore.ArrayUnion([req.auth.uid])})
    return {"success": True}


# The inverse of rsvp_to_quest.
@https_fn.on_call()
def cancel_rsvp(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "user")

    quest_id = req.data.get("questId")
    if not quest_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId is required.",
        )

    ref = firestore.client().collection("quests").document(quest_id)
    ref.update({"rsvpd": firestore.ArrayRemove([req.auth.uid])})
    return {"success": True}


# Callable from the org dashboard's "view attendees" button (own quests
# only) and the admin dashboard (any quest). The client Firestore rules
# only let a user read their OWN users/{uid} doc, so resolving a quest's
# rsvpd uids into names/emails has to happen here, via the Admin SDK.
@https_fn.on_call()
def list_quest_attendees(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)

    quest_id = req.data.get("questId")
    if not quest_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId is required.",
        )

    db = firestore.client()
    snap = db.collection("quests").document(quest_id).get()
    if not snap.exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND,
            f"No quest {quest_id}.",
        )

    quest = snap.to_dict()
    role = req.auth.token.get("role")
    is_owning_org = role == "organization" and quest.get("orgId") == req.auth.uid
    if role != "admin" and not is_owning_org:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            "You can only view attendees for your own organization's quests.",
        )

    attendees = []
    for uid in quest.get("rsvpd", []):
        user_snap = db.collection("users").document(uid).get()
        user_data = user_snap.to_dict() if user_snap.exists else {}
        attendees.append({
            "uid": uid,
            "name": user_data.get("name"),
            "email": user_data.get("email"),
        })

    return {"attendees": attendees}
