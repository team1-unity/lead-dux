import base64
import json
import secrets
from datetime import datetime, timedelta, timezone
from io import BytesIO

import qrcode
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


# Attendance / QR check-in ---------------------------------------------------
#
# A quest's own doc gets `eventDate` (required) and `eventEndTime` (optional)
# at creation time (see create_quest/create_default_quest below). Each RSVP
# gets a sibling doc at quests/{questId}/attendance/{uid} holding a random
# token. That token is never written anywhere the client can read directly —
# it only ever leaves the server embedded in a QR code image, returned over
# the same callable-function response channel every other action here
# already uses. Scanning the code is just handing that same token back via
# check_in_attendee.

DEFAULT_EVENT_WINDOW_HOURS = 6  # used when a quest has no explicit end time


def _to_utc(value: datetime) -> datetime:
    # Firestore gives back timezone-aware datetimes for Timestamp fields;
    # this just guards against a naive one slipping in some other way.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _qr_expires_at(event_date: datetime, event_end_time: datetime | None) -> datetime:
    if event_end_time is not None:
        return _to_utc(event_end_time)
    return _to_utc(event_date) + timedelta(hours=DEFAULT_EVENT_WINDOW_HOURS)


def _make_qr_data_uri(quest_id: str, uid: str, token: str) -> str:
    payload = json.dumps({"questId": quest_id, "uid": uid, "token": token})
    image = qrcode.make(payload)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _attendance_ref(db, quest_id: str, uid: str):
    return db.collection("quests").document(quest_id).collection("attendance").document(uid)


def _review_ref(db, quest_id: str, uid: str):
    return db.collection("quests").document(quest_id).collection("reviews").document(uid)


def _delete_quest(quest_ref):
    # Firestore never cascades a subcollection when its parent doc is
    # deleted — quests/{id}/attendance/* and quests/{id}/reviews/* would
    # otherwise sit there orphaned (and readable by nobody, but still
    # consuming storage) forever. Small subcollections at this app's
    # scale, so a plain loop is fine; a bulk-delete API would be worth it
    # if quests ever had thousands of RSVPs/reviews each.
    for subcollection in ("attendance", "reviews"):
        for doc in quest_ref.collection(subcollection).stream():
            doc.reference.delete()
    quest_ref.delete()


def _parse_event_datetime(value, field_name: str) -> datetime:
    if not value:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"{field_name} is required and must be an ISO datetime string.",
        )
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"{field_name} must be an ISO datetime string.",
        )
    return _to_utc(parsed)


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
        "ltag": [],
        "etag": [],
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
        _delete_quest(quest_doc.reference)
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
    event_date = _parse_event_datetime(req.data.get("eventDate"), "eventDate")
    event_end_time = (
        _parse_event_datetime(req.data.get("eventEndTime"), "eventEndTime")
        if req.data.get("eventEndTime")
        else None
    )

    if not title or not description:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "title and description are required.",
        )
    if event_end_time is not None and event_end_time <= event_date:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "eventEndTime must be after eventDate.",
        )

    db = firestore.client()
    org_snap = db.collection("organizations").document(req.auth.uid).get()
    org_name = org_snap.to_dict().get("name") if org_snap.exists else None

    doc_ref = db.collection("quests").document()
    doc_ref.set({
        "title": title,
        "description": description,
        "tags": tags,
        "eventDate": event_date,
        "eventEndTime": event_end_time,
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
    event_date = _parse_event_datetime(req.data.get("eventDate"), "eventDate")
    event_end_time = (
        _parse_event_datetime(req.data.get("eventEndTime"), "eventEndTime")
        if req.data.get("eventEndTime")
        else None
    )

    if not title or not description:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "title and description are required.",
        )
    if event_end_time is not None and event_end_time <= event_date:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "eventEndTime must be after eventDate.",
        )

    doc_ref = firestore.client().collection("quests").document()
    doc_ref.set({
        "title": title,
        "description": description,
        "tags": tags,
        "eventDate": event_date,
        "eventEndTime": event_end_time,
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

    _delete_quest(ref)
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

    db = firestore.client()
    ref = db.collection("quests").document(quest_id)
    snap = ref.get()
    if not snap.exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND,
            f"No quest {quest_id}.",
        )

    quest = snap.to_dict()
    event_date = quest.get("eventDate")
    if event_date is None:
        # Predates the eventDate field (see create_quest/create_default_quest)
        # — nothing to anchor a QR expiry to, and there's no edit-quest UI to
        # backfill one, so this quest needs to be recreated instead.
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "This quest has no event date on file and can't accept RSVPs. Ask the organization to recreate it.",
        )

    ref.update({"rsvpd": firestore.ArrayUnion([req.auth.uid])})

    # A fresh token every time — cancel_rsvp always deletes the attendance
    # doc first, so re-RSVPing after a cancel never reuses an old token.
    token = secrets.token_urlsafe(24)
    qr_expires_at = _qr_expires_at(event_date, quest.get("eventEndTime"))
    _attendance_ref(db, quest_id, req.auth.uid).set({
        "token": token,
        "status": "rsvpd",
        "qrExpiresAt": qr_expires_at,
        "checkedInAt": None,
        "createdAt": firestore.SERVER_TIMESTAMP,
    })

    return {
        "success": True,
        "qr": _make_qr_data_uri(quest_id, req.auth.uid, token),
        "qrExpiresAt": qr_expires_at.isoformat(),
    }


# The inverse of rsvp_to_quest. Deleting the attendance doc (rather than
# e.g. marking it cancelled) means a later re-RSVP always starts from a
# clean slate — see the comment in rsvp_to_quest.
@https_fn.on_call()
def cancel_rsvp(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "user")

    quest_id = req.data.get("questId")
    if not quest_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId is required.",
        )

    db = firestore.client()
    db.collection("quests").document(quest_id).update({"rsvpd": firestore.ArrayRemove([req.auth.uid])})
    _attendance_ref(db, quest_id, req.auth.uid).delete()
    return {"success": True}


# Callable from the quest list — re-renders the caller's own QR code without
# minting a new token, so leaving the page and coming back (or opening it on
# a second device) still shows a scannable code instead of a dead end. No
# targetUid, same as update_interests — this can only ever read the caller's
# own attendance doc.
@https_fn.on_call()
def get_quest_qr(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "user")

    quest_id = req.data.get("questId")
    if not quest_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId is required.",
        )

    db = firestore.client()
    snap = _attendance_ref(db, quest_id, req.auth.uid).get()
    if not snap.exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND,
            "You haven't RSVP'd to this quest.",
        )

    attendance = snap.to_dict()
    qr_expires_at = attendance["qrExpiresAt"]
    return {
        "qr": _make_qr_data_uri(quest_id, req.auth.uid, attendance["token"]),
        "qrExpiresAt": qr_expires_at.isoformat(),
        "status": attendance["status"],
        "expired": datetime.now(timezone.utc) > _to_utc(qr_expires_at),
    }


# Callable from the org dashboard's "scan to check in" screen (own quests
# only) or the admin dashboard (any quest). questId/uid/token come from
# decoding the scanned QR image client-side — see _make_qr_data_uri for the
# payload shape. Idempotent: scanning an already-checked-in code again
# succeeds with alreadyCheckedIn=True rather than erroring, since a double
# scan at the door is an expected accident, not an attack.
@https_fn.on_call()
def check_in_attendee(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)

    quest_id = req.data.get("questId")
    uid = req.data.get("uid")
    token = req.data.get("token")
    if not quest_id or not uid or not token:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId, uid, and token are required.",
        )

    db = firestore.client()
    quest_snap = db.collection("quests").document(quest_id).get()
    if not quest_snap.exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND,
            f"No quest {quest_id}.",
        )

    role = req.auth.token.get("role")
    is_owning_org = role == "organization" and quest_snap.to_dict().get("orgId") == req.auth.uid
    if role != "admin" and not is_owning_org:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            "You can only check in attendees for your own organization's quests.",
        )

    attendance_ref = _attendance_ref(db, quest_id, uid)
    attendance_snap = attendance_ref.get()
    if not attendance_snap.exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND,
            "No RSVP found for this QR code.",
        )

    attendance = attendance_snap.to_dict()
    # Constant-time comparison — this token is a bearer credential, so
    # timing differences on a naive `!=` could in principle leak how many
    # leading characters matched.
    if not secrets.compare_digest(attendance["token"], token):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            "Invalid QR code.",
        )
    if datetime.now(timezone.utc) > _to_utc(attendance["qrExpiresAt"]):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "This QR code has expired.",
        )

    user_snap = db.collection("users").document(uid).get()
    user_data = user_snap.to_dict() if user_snap.exists else {}
    attendee = {"uid": uid, "name": user_data.get("name"), "email": user_data.get("email")}

    if attendance["status"] == "checked_in":
        return {"success": True, "alreadyCheckedIn": True, "attendee": attendee}

    attendance_ref.update({"status": "checked_in", "checkedInAt": firestore.SERVER_TIMESTAMP})
    return {"success": True, "alreadyCheckedIn": False, "attendee": attendee}


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

    attendance_by_uid = {
        doc.id: doc.to_dict()
        for doc in db.collection("quests").document(quest_id).collection("attendance").stream()
    }

    attendees = []
    for uid in quest.get("rsvpd", []):
        user_snap = db.collection("users").document(uid).get()
        user_data = user_snap.to_dict() if user_snap.exists else {}
        attendance = attendance_by_uid.get(uid)
        checked_in_at = attendance.get("checkedInAt") if attendance else None
        attendees.append({
            "uid": uid,
            "name": user_data.get("name"),
            "email": user_data.get("email"),
            "status": attendance.get("status") if attendance else "rsvpd",
            "checkedInAt": checked_in_at.isoformat() if checked_in_at else None,
        })

    return {"attendees": attendees}


# Reviews ---------------------------------------------------------------
#
# One review per user per quest — the doc id is the reviewer's uid, same
# pattern as attendance. Gated on having actually attended (checked_in via
# the QR check-in flow, not just RSVP'd). reviewCount/avgRating are
# denormalized onto the quest doc itself rather than left only in the
# reviews subcollection, since members already have read access to quests
# but not to this subcollection (see firestore.rules) — this is what lets
# the quest list show a rating without any new read access.

MIN_RATING = 1
MAX_RATING = 5


def _record_review(transaction, quest_ref, review_ref, rating, body):
    quest_snap = quest_ref.get(transaction=transaction)
    review_snap = review_ref.get(transaction=transaction)
    if review_snap.exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.ALREADY_EXISTS,
            "You've already reviewed this quest.",
        )

    quest = quest_snap.to_dict()
    current_count = quest.get("reviewCount", 0)
    current_avg = quest.get("avgRating", 0)
    new_count = current_count + 1
    new_avg = ((current_avg * current_count) + rating) / new_count

    transaction.set(review_ref, {
        "rating": rating,
        "body": body,
        "createdAt": firestore.SERVER_TIMESTAMP,
    })
    transaction.update(quest_ref, {"reviewCount": new_count, "avgRating": new_avg})


@https_fn.on_call()
def submit_review(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "user")

    quest_id = req.data.get("questId")
    rating = req.data.get("rating")
    body = req.data.get("body")

    if not quest_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId is required.",
        )
    if isinstance(rating, bool) or not isinstance(rating, int) or not (MIN_RATING <= rating <= MAX_RATING):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"rating must be an integer between {MIN_RATING} and {MAX_RATING}.",
        )
    if not isinstance(body, str) or not body.strip():
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "body is required.",
        )

    db = firestore.client()
    quest_ref = db.collection("quests").document(quest_id)
    quest_snap = quest_ref.get()
    if not quest_snap.exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND,
            f"No quest {quest_id}.",
        )
    if not quest_snap.to_dict().get("orgId"):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "This quest has no organization to review.",
        )

    attendance_snap = _attendance_ref(db, quest_id, req.auth.uid).get()
    attended = attendance_snap.exists and attendance_snap.to_dict().get("status") == "checked_in"
    if not attended:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "You can only review quests you've checked in to.",
        )

    review_ref = _review_ref(db, quest_id, req.auth.uid)
    # firestore.transactional is applied here, at call time, rather than as
    # a decorator on _record_review's def — a decorator would bind to
    # whichever `firestore` module is in scope at import time, permanently,
    # which breaks swapping in the fake Firestore client tests use.
    firestore.transactional(_record_review)(db.transaction(), quest_ref, review_ref, rating, body.strip())

    return {"success": True}


# Callable from the quest list — lets a member see their own review for a
# quest they've already reviewed (e.g. after navigating away and back),
# same self-only shape as get_quest_qr. No targetUid, so there's nothing to
# escalate.
@https_fn.on_call()
def get_my_review(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "user")

    quest_id = req.data.get("questId")
    if not quest_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId is required.",
        )

    snap = _review_ref(firestore.client(), quest_id, req.auth.uid).get()
    if not snap.exists:
        return {"review": None}

    review = snap.to_dict()
    created_at = review.get("createdAt")
    return {
        "review": {
            "rating": review.get("rating"),
            "body": review.get("body"),
            "createdAt": created_at.isoformat() if created_at else None,
        }
    }


# Callable from the org dashboard's "view reviews" button (own quests
# only) and the admin dashboard (any quest) — same ownership gate as
# list_quest_attendees.
@https_fn.on_call()
def list_quest_reviews(req: https_fn.CallableRequest) -> dict:
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
            "You can only view reviews for your own organization's quests.",
        )

    reviews = []
    for doc in db.collection("quests").document(quest_id).collection("reviews").stream():
        review = doc.to_dict()
        user_snap = db.collection("users").document(doc.id).get()
        user_data = user_snap.to_dict() if user_snap.exists else {}
        created_at = review.get("createdAt")
        reviews.append({
            "uid": doc.id,
            "name": user_data.get("name"),
            "rating": review.get("rating"),
            "body": review.get("body"),
            "createdAt": created_at.isoformat() if created_at else None,
        })

    return {"reviews": reviews}


# Callable from the org dashboard — lets an organization set the location
# areas (ltag) and activity/event types (etag) they operate in. Separate
# from a quest's own tags (which describe one event); these describe the
# organization itself, for future browse/filter-by-location-or-activity-type
# features.
@https_fn.on_call()
def update_organization_tags(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "organization")

    ltag = req.data.get("ltag")
    etag = req.data.get("etag")

    if not isinstance(ltag, list) or not isinstance(etag, list):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "ltag and etag must both be lists of strings.",
        )

    firestore.client().collection("organizations").document(req.auth.uid).update({
        "ltag": ltag,
        "etag": etag,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    return {"success": True}


# Callable from Settings — lets an already-onboarded "user" change their
# interests after the fact (onboarding only ever sets them once).
@https_fn.on_call()
def update_interests(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "user")

    interests = req.data.get("interests")
    if not isinstance(interests, list) or not interests:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "interests must be a non-empty list.",
        )

    firestore.client().collection("users").document(req.auth.uid).update({
        "interests": interests,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    return {"success": True}


# Callable from Settings' danger zone. Operates on the caller's own uid only
# (no targetUid) — deleting someone else's account is out of scope for this
# function; admins already have delete_organization/set_user_role for that.
# Cascades before removing the Auth account itself: an organization's owned
# quests and profile are deleted outright, while anyone else is simply
# pulled out of every quest's rsvpd list rather than the quest being touched.
@https_fn.on_call()
def delete_account(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)

    uid = req.auth.uid
    role = req.auth.token.get("role")
    db = firestore.client()

    if role == "organization":
        for quest_doc in db.collection("quests").where("orgId", "==", uid).stream():
            _delete_quest(quest_doc.reference)
        db.collection("organizations").document(uid).delete()
    else:
        for quest_doc in db.collection("quests").where("rsvpd", "array_contains", uid).stream():
            quest_doc.reference.update({"rsvpd": firestore.ArrayRemove([uid])})
            _attendance_ref(db, quest_doc.id, uid).delete()

    # Safe unconditionally — Firestore .delete() on a doc that doesn't exist
    # (e.g. no ORGREQ was ever filed, or the account is an admin with no
    # users/{uid} doc per complete_signup) is a no-op, not an error.
    db.collection("ORGREQ").document(uid).delete()
    db.collection("users").document(uid).delete()
    auth.delete_user(uid)

    return {"success": True}
