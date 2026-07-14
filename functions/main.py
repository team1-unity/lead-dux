import base64
import calendar
import json
import secrets
from datetime import datetime, timedelta, timezone
from io import BytesIO
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

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
#   individual: (no claim) -> onboarding_user -> user
#   organization: (no claim) -> onboarding_org -> pending_org -> organization
# Which branch a brand-new signup starts on is chosen at signup time (see
# complete_signup's accountType) and is permanent — there's no in-app path
# from one branch to the other. Someone who picks the wrong one has to
# delete their account (delete_account) and sign up again. admin is granted
# out-of-band (config/admins allowlist or set_user_role).
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


def _review_ref(db, series_id: str, uid: str, quest_id: str):
    # Doc id is {uid}_{questId}, not just uid — a member can review more
    # than one date in the same series (see submit_review), so uid alone
    # can no longer uniquely identify a review within a series.
    return db.collection("questSeries").document(series_id).collection("reviews").document(f"{uid}_{quest_id}")


def _delete_series_reviews(db, series_id: str):
    series_ref = db.collection("questSeries").document(series_id)
    for doc in series_ref.collection("reviews").stream():
        doc.reference.delete()
    series_ref.delete()


def _delete_quest(db, quest_ref):
    # Firestore never cascades a subcollection when its parent doc is
    # deleted — quests/{id}/attendance/* would otherwise sit there orphaned
    # (and readable by nobody, but still consuming storage) forever. Small
    # subcollection at this app's scale, so a plain loop is fine; a
    # bulk-delete API would be worth it if quests ever had thousands of
    # RSVPs each.
    #
    # Deletes only this one occurrence — a recurring series' other dates
    # are untouched (see delete_quest_series for deleting a whole series at
    # once). Reviews live under questSeries/{seriesId}, not under any one
    # occurrence's own doc (see submit_review), and this never touches them
    # — a review stays part of the series' history even after the specific
    # date it was written for is deleted. Callers that really do want the
    # whole series' reviews gone (delete_quest_series with no keepQuestId,
    # delete_organization, delete_account) do that explicitly themselves via
    # _delete_series_reviews.
    for doc in quest_ref.collection("attendance").stream():
        doc.reference.delete()
    quest_ref.delete()


def _parse_event_datetime(value, field_name: str, tz: str) -> datetime:
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
    if parsed.tzinfo is None:
        # <input type="datetime-local"> sends a naive "wall clock" string
        # with no UTC offset — interpret it as being in the quest's own
        # timezone (correctly accounting for that zone's DST rules on this
        # particular date) rather than assuming it's already UTC.
        parsed = parsed.replace(tzinfo=ZoneInfo(tz))
    return parsed.astimezone(timezone.utc)


def _validate_timezone(value) -> str:
    if not isinstance(value, str) or not value:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "timezone is required and must be an IANA timezone name (e.g. \"America/New_York\").",
        )
    try:
        ZoneInfo(value)
    except ZoneInfoNotFoundError:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f'"{value}" is not a recognized timezone.',
        )
    return value


def _validate_capacity(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "capacity must be a positive integer, or omitted for unlimited.",
        )
    return value


# Scheduling multiple/recurring dates for one quest --------------------------
#
# Doesn't introduce a separate template/instance collection — every
# occurrence is a full, self-contained quests/{id} doc exactly like before
# (see _quest_doc_fields), just sharing a `seriesId` with its siblings. Every
# quest has a seriesId, even a plain one-off: it's just its own doc id, so
# "does this belong to a multi-instance series" is always "any OTHER quest
# has the same seriesId" — no special-cased "root" doc whose survival the
# rest of the series depends on. That's what lets delete_quest remove a
# single occurrence (including the one originally created first) without
# stranding the rest of the series (see delete_quest_series for removing a
# whole series at once). RSVP, QR check-in, and reviews needed zero
# changes: they already operate per quest doc.

RECURRENCE_FREQUENCIES = {"daily", "weekly", "monthly"}
MAX_RECURRING_INSTANCES = 104  # ~2 years of weekly occurrences


def _add_months(date: datetime, months: int) -> datetime:
    month_index = date.month - 1 + months
    year = date.year + month_index // 12
    month = month_index % 12 + 1
    day = min(date.day, calendar.monthrange(year, month)[1])  # clamp e.g. Jan 31 + 1 month -> Feb 28/29
    return date.replace(year=year, month=month, day=day)


def _advance(date: datetime, frequency: str, n: int) -> datetime:
    if frequency == "daily":
        return date + timedelta(days=n)
    if frequency == "weekly":
        return date + timedelta(weeks=n)
    return _add_months(date, n)  # the only option _validate_frequency still allows through


def _validate_frequency(value) -> str:
    if value not in RECURRENCE_FREQUENCIES:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"frequency must be one of {sorted(RECURRENCE_FREQUENCIES)}.",
        )
    return value


# `until` is compared by calendar date in the series' own timezone, not by
# exact instant — otherwise an occurrence later in the day on the "until"
# date itself would be incorrectly excluded (e.g. "until Dec 1" should
# include a Dec 1 occurrence regardless of what time of day it's at).
def _generate_series_dates(first_event_date: datetime, frequency: str, until: datetime, tz: str) -> list:
    zone = ZoneInfo(tz)
    until_date = until.astimezone(zone).date()
    if until_date <= first_event_date.astimezone(zone).date():
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "until must be after the first event date.",
        )

    dates = []
    n = 0
    while True:
        occurrence = _advance(first_event_date, frequency, n)
        if occurrence.astimezone(zone).date() > until_date:
            break
        dates.append(occurrence)
        n += 1
        if len(dates) > MAX_RECURRING_INSTANCES:
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                f"That range would create more than {MAX_RECURRING_INSTANCES} occurrences — "
                "shorten it or pick a less frequent cadence.",
            )
    return dates


def _quest_doc_fields(
    *, title, description, tags, location, tz, capacity, series_id,
    recurrence_frequency, recurrence_until, event_date, event_end_time,
    org_id, org_name, is_default,
):
    return {
        "title": title,
        "description": description,
        "tags": tags,
        "location": location,
        "timezone": tz,
        "capacity": capacity,
        "seriesId": series_id,
        "recurrenceFrequency": recurrence_frequency,
        "recurrenceUntil": recurrence_until,
        "eventDate": event_date,
        "eventEndTime": event_end_time,
        "orgId": org_id,
        "orgName": org_name,
        "isDefault": is_default,
        "rsvpd": [],
        "createdAt": firestore.SERVER_TIMESTAMP,
    }


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
# the one and only signup path, for both accountTypes. accountType chooses
# which branch of the role state machine a brand-new account starts on:
# "organization" skips straight to onboarding_org (no users/{uid} profile —
# organizations get their own doc later, at approve_organization) instead of
# onboarding_user. That choice is permanent — see the state-machine note
# above.
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

    if req.data.get("accountType") == "organization":
        auth.set_custom_user_claims(uid, {"role": "onboarding_org"})
        return {"success": True, "role": "onboarding_org"}

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


# Callable from the org-details form, for an account currently in
# onboarding_org (the state a brand-new org signup reaches directly via
# complete_signup). A "user" who meant to sign up as an organization has no
# in-app conversion path — they delete their account (Settings) and sign up
# again choosing the organization option.
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
    series_ids = set()
    for quest_doc in db.collection("quests").where("orgId", "==", target_uid).stream():
        quest = quest_doc.to_dict()
        series_ids.add(quest.get("seriesId") or quest_doc.id)
        _delete_quest(db, quest_doc.reference)
    for series_id in series_ids:
        _delete_series_reviews(db, series_id)
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
    location = req.data.get("location") or ""
    tz = _validate_timezone(req.data.get("timezone"))
    if not title or not description:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "title and description are required.",
        )

    event_date = _parse_event_datetime(req.data.get("eventDate"), "eventDate", tz)
    event_end_time = (
        _parse_event_datetime(req.data.get("eventEndTime"), "eventEndTime", tz)
        if req.data.get("eventEndTime")
        else None
    )
    if event_end_time is not None and event_end_time <= event_date:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "eventEndTime must be after eventDate.",
        )
    capacity = _validate_capacity(req.data.get("capacity"))

    db = firestore.client()
    org_snap = db.collection("organizations").document(req.auth.uid).get()
    org_name = org_snap.to_dict().get("name") if org_snap.exists else None

    doc_ref = db.collection("quests").document()
    doc_ref.set(_quest_doc_fields(
        title=title, description=description, tags=tags, location=location, tz=tz,
        capacity=capacity, series_id=doc_ref.id, recurrence_frequency=None, recurrence_until=None,
        event_date=event_date, event_end_time=event_end_time,
        org_id=req.auth.uid, org_name=org_name, is_default=False,
    ))
    return {"success": True, "questId": doc_ref.id}


# Callable from the org dashboard's "recurring quest" form. Generates every
# occurrence up front as one batch — a shared seriesId is what a later
# delete_quest_series call groups on, not any special status on this first
# doc (see the module note above _generate_series_dates). Admin can call
# this too, same organization/admin split as create_quest/create_default_quest,
# so admin can create a recurring default (neighborhood) quest directly
# instead of having to create a standalone one and convert it afterward.
@https_fn.on_call()
def create_recurring_quest(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "organization", "admin")

    title = req.data.get("title")
    description = req.data.get("description")
    tags = req.data.get("tags") or []
    location = req.data.get("location") or ""
    tz = _validate_timezone(req.data.get("timezone"))
    if not title or not description:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "title and description are required.",
        )

    first_event_date = _parse_event_datetime(req.data.get("eventDate"), "eventDate", tz)
    event_end_time = (
        _parse_event_datetime(req.data.get("eventEndTime"), "eventEndTime", tz)
        if req.data.get("eventEndTime")
        else None
    )
    if event_end_time is not None and event_end_time <= first_event_date:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "eventEndTime must be after eventDate.",
        )
    duration = (event_end_time - first_event_date) if event_end_time is not None else None
    capacity = _validate_capacity(req.data.get("capacity"))

    frequency = _validate_frequency(req.data.get("frequency"))
    until = _parse_event_datetime(req.data.get("until"), "until", tz)
    occurrence_dates = _generate_series_dates(first_event_date, frequency, until, tz)

    db = firestore.client()
    is_admin = req.auth.token.get("role") == "admin"
    if is_admin:
        org_id, org_name, is_default = None, "Neighborhood", True
    else:
        org_snap = db.collection("organizations").document(req.auth.uid).get()
        org_id, org_name, is_default = req.auth.uid, (org_snap.to_dict().get("name") if org_snap.exists else None), False

    batch = db.batch()
    series_id = None
    quest_ids = []
    for occurrence_date in occurrence_dates:
        doc_ref = db.collection("quests").document()
        if series_id is None:
            series_id = doc_ref.id
        occurrence_end = occurrence_date + duration if duration is not None else None
        batch.set(doc_ref, _quest_doc_fields(
            title=title, description=description, tags=tags, location=location, tz=tz,
            capacity=capacity, series_id=series_id,
            recurrence_frequency=frequency, recurrence_until=until,
            event_date=occurrence_date, event_end_time=occurrence_end,
            org_id=org_id, org_name=org_name, is_default=is_default,
        ))
        quest_ids.append(doc_ref.id)
    batch.commit()

    return {"success": True, "seriesId": series_id, "questIds": quest_ids}


# Callable from the org (or admin, for a default quest) dashboard's "make
# recurring" action on an existing standalone quest. Keeps that quest as
# the series' first occurrence — only the remaining dates get created.
@https_fn.on_call()
def make_quest_recurring(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)

    quest_id = req.data.get("questId")
    if not quest_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId is required.",
        )

    db = firestore.client()
    quest_ref = db.collection("quests").document(quest_id)
    quest_snap = quest_ref.get()
    if not quest_snap.exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND,
            f"No quest {quest_id}.",
        )
    quest = quest_snap.to_dict()

    role = req.auth.token.get("role")
    is_owning_org = role == "organization" and quest.get("orgId") == req.auth.uid
    if role != "admin" and not is_owning_org:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            "You can only manage your own organization's quests.",
        )

    series_id = quest.get("seriesId") or quest_id
    siblings = list(db.collection("quests").where("seriesId", "==", series_id).stream())
    if len(siblings) > 1:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "This quest is already part of a series.",
        )

    event_date = quest.get("eventDate")
    if event_date is None:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "This quest has no event date on file and can't be made recurring.",
        )
    tz = quest.get("timezone") or "UTC"
    event_end_time = quest.get("eventEndTime")
    duration = (event_end_time - event_date) if event_end_time is not None else None

    frequency = _validate_frequency(req.data.get("frequency"))
    until = _parse_event_datetime(req.data.get("until"), "until", tz)
    occurrence_dates = _generate_series_dates(event_date, frequency, until, tz)
    remaining_dates = occurrence_dates[1:]  # the first is this quest's own existing date

    batch = db.batch()
    batch.update(quest_ref, {
        "seriesId": series_id,
        "recurrenceFrequency": frequency,
        "recurrenceUntil": until,
    })
    quest_ids = [quest_id]
    for occurrence_date in remaining_dates:
        doc_ref = db.collection("quests").document()
        occurrence_end = occurrence_date + duration if duration is not None else None
        batch.set(doc_ref, _quest_doc_fields(
            title=quest["title"], description=quest["description"], tags=quest.get("tags", []),
            location=quest.get("location", ""), tz=tz, capacity=quest.get("capacity"),
            series_id=series_id, recurrence_frequency=frequency, recurrence_until=until,
            event_date=occurrence_date, event_end_time=occurrence_end,
            org_id=quest.get("orgId"), org_name=quest.get("orgName"), is_default=quest.get("isDefault", False),
        ))
        quest_ids.append(doc_ref.id)
    batch.commit()

    return {"success": True, "seriesId": series_id, "questIds": quest_ids}


# Callable from the admin dashboard's "add default neighborhood quest" form —
# a quest with no owning organization, shown to everyone.
@https_fn.on_call()
def create_default_quest(req: https_fn.CallableRequest) -> dict:
    _require_admin(req)

    title = req.data.get("title")
    description = req.data.get("description")
    tags = req.data.get("tags") or []
    location = req.data.get("location") or ""
    tz = _validate_timezone(req.data.get("timezone"))
    if not title or not description:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "title and description are required.",
        )

    event_date = _parse_event_datetime(req.data.get("eventDate"), "eventDate", tz)
    event_end_time = (
        _parse_event_datetime(req.data.get("eventEndTime"), "eventEndTime", tz)
        if req.data.get("eventEndTime")
        else None
    )
    if event_end_time is not None and event_end_time <= event_date:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "eventEndTime must be after eventDate.",
        )
    capacity = _validate_capacity(req.data.get("capacity"))

    doc_ref = firestore.client().collection("quests").document()
    doc_ref.set(_quest_doc_fields(
        title=title, description=description, tags=tags, location=location, tz=tz,
        capacity=capacity, series_id=doc_ref.id, recurrence_frequency=None, recurrence_until=None,
        event_date=event_date, event_end_time=event_end_time,
        org_id=None, org_name="Neighborhood", is_default=True,
    ))
    return {"success": True, "questId": doc_ref.id}


# Callable from the org dashboard (own quests only) and the admin dashboard
# (any quest, including default neighborhood ones). Deletes just this one
# occurrence — see delete_quest_series to remove an entire recurring series
# at once.
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

    _delete_quest(db, ref)
    return {"success": True}


# Callable from the org dashboard's "delete all in series" / "keep only
# this date" actions (own quests only) or the admin dashboard (any series).
# questId can be any occurrence in the series, not just the first —
# seriesId grouping doesn't depend on which one that was (see the module
# note above _generate_series_dates).
#
# Without keepQuestId: deletes every occurrence in the series. With it:
# deletes every occurrence EXCEPT keepQuestId, and collapses that survivor
# back into a plain standalone quest (fresh self-referential seriesId,
# recurrence cleared) — "cancel the recurrence but keep this one date".
@https_fn.on_call()
def delete_quest_series(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)

    quest_id = req.data.get("questId")
    if not quest_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId is required.",
        )
    keep_quest_id = req.data.get("keepQuestId")

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
            "You can only delete your own organization's quest series.",
        )

    series_id = quest.get("seriesId") or quest_id
    deleted_count = 0
    for doc in db.collection("quests").where("seriesId", "==", series_id).stream():
        if keep_quest_id and doc.id == keep_quest_id:
            # seriesId is deliberately left as-is, not reset to doc.id —
            # this quest's reviews live under questSeries/{series_id} (see
            # submit_review), and keeping the same series_id is what keeps
            # them attached after every other date is gone. Nothing breaks
            # by not resetting it: with every sibling below being deleted,
            # a seriesId query for it now only ever matches this one doc,
            # so it already behaves like a standalone quest.
            doc.reference.update({
                "recurrenceFrequency": None,
                "recurrenceUntil": None,
            })
            continue
        _delete_quest(db, doc.reference)
        deleted_count += 1

    # Only when the ENTIRE series is gone (no date kept) does its review
    # history go with it — _delete_quest itself never touches reviews (see
    # its own comment), specifically so removing individual dates above
    # doesn't disturb them.
    if not keep_quest_id:
        _delete_series_reviews(db, series_id)

    return {"success": True, "deletedCount": deleted_count, "keptQuestId": keep_quest_id}


def _record_rsvp(transaction, quest_ref, uid):
    quest_snap = quest_ref.get(transaction=transaction)
    quest = quest_snap.to_dict()
    rsvpd = quest.get("rsvpd", [])
    capacity = quest.get("capacity")
    if uid not in rsvpd and capacity is not None and len(rsvpd) >= capacity:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "This quest is full.",
        )
    transaction.update(quest_ref, {"rsvpd": firestore.ArrayUnion([uid])})


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

    # Capacity has to be checked and the rsvpd array updated as one atomic
    # step — otherwise two people RSVPing for the last open spot at the
    # same moment could both read "1 spot left" and both get in, same
    # class of race as submit_review's avgRating (see _record_review).
    # Already-RSVP'd is exempted from the capacity check entirely: without
    # that, someone who joined before the quest filled up would get
    # incorrectly rejected on a harmless repeat call.
    firestore.transactional(_record_rsvp)(db.transaction(), ref, req.auth.uid)

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
# One review per user PER OCCURRENCE they attended — the doc id is
# {uid}_{questId}, same subcollection pattern as attendance but keyed on
# the pair since a member who attends several dates in a recurring series
# can leave a separate review for each one. Gated on having actually
# attended (checked_in via the QR check-in flow, not just RSVP'd) that
# specific date. Every review in a series, across every date, rolls up
# into one reviewCount/avgRating on the questSeries/{seriesId} doc itself
# (see _record_review) — so the aggregate "carries over" and stays visible
# from any occurrence, while the individual reviews stay tied to whichever
# date they were actually written for (see eventDate below).

MIN_RATING = 1
MAX_RATING = 5


def _record_review(transaction, series_ref, review_ref, rating, body, uid, quest_id, event_date):
    series_snap = series_ref.get(transaction=transaction)
    review_snap = review_ref.get(transaction=transaction)
    if review_snap.exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.ALREADY_EXISTS,
            "You've already reviewed this date.",
        )

    series = series_snap.to_dict() or {}
    current_count = series.get("reviewCount", 0)
    current_avg = series.get("avgRating", 0)
    new_count = current_count + 1
    new_avg = ((current_avg * current_count) + rating) / new_count

    transaction.set(review_ref, {
        "uid": uid,
        "questId": quest_id,
        "eventDate": event_date,
        "rating": rating,
        "body": body,
        "createdAt": firestore.SERVER_TIMESTAMP,
    })
    # merge=True since this may be the series' first review ever, in which
    # case questSeries/{series_id} doesn't exist yet — an .update() would
    # fail outright, and a non-merge .set() would be equally correct here
    # (reviewCount/avgRating are its only fields today) but merge is the
    # right instinct if this doc ever grows more fields later.
    transaction.set(series_ref, {"reviewCount": new_count, "avgRating": new_avg}, merge=True)


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
    quest = quest_snap.to_dict()
    if not quest.get("orgId"):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "This quest has no organization to review.",
        )

    # Attendance is checked against this specific occurrence — reviewing
    # still requires having actually checked in to *a* date, just not
    # necessarily whichever one happens to be selected when this is called.
    attendance_snap = _attendance_ref(db, quest_id, req.auth.uid).get()
    attended = attendance_snap.exists and attendance_snap.to_dict().get("status") == "checked_in"
    if not attended:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "You can only review quests you've checked in to.",
        )

    # The review itself is tied to this specific occurrence — one review
    # per person per date, so attending several dates in a recurring series
    # lets a member review each one. The aggregate rating still belongs to
    # the whole series (see _quest_doc_fields/module note above
    # _generate_series_dates), rolling every date's reviews into one
    # reviewCount/avgRating that's visible no matter which date is selected.
    series_id = quest.get("seriesId") or quest_id
    series_ref = db.collection("questSeries").document(series_id)
    review_ref = _review_ref(db, series_id, req.auth.uid, quest_id)
    # firestore.transactional is applied here, at call time, rather than as
    # a decorator on _record_review's def — a decorator would bind to
    # whichever `firestore` module is in scope at import time, permanently,
    # which breaks swapping in the fake Firestore client tests use.
    firestore.transactional(_record_review)(
        db.transaction(), series_ref, review_ref, rating, body.strip(), req.auth.uid, quest_id, quest.get("eventDate"),
    )

    return {"success": True}


# Callable from the quest list — lets a member see their own review for
# this specific occurrence (e.g. after navigating away and back), same
# self-only shape as get_quest_qr. No targetUid, so there's nothing to
# escalate. Scoped to questId, not the whole series — a member who's
# reviewed one date but not another should still see the submission form
# for the un-reviewed one.
@https_fn.on_call()
def get_my_review(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "user")

    quest_id = req.data.get("questId")
    if not quest_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId is required.",
        )

    db = firestore.client()
    quest_snap = db.collection("quests").document(quest_id).get()
    if not quest_snap.exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND,
            f"No quest {quest_id}.",
        )
    series_id = quest_snap.to_dict().get("seriesId") or quest_id

    snap = _review_ref(db, series_id, req.auth.uid, quest_id).get()
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


# Callable from the org dashboard's "view reviews" button, the admin
# dashboard (any quest), and the member-facing quest list's own "view
# reviews" button — reviews are meant to help anyone deciding whether to
# attend, same as any public review platform, so unlike list_quest_attendees
# (which exposes emails) this has no ownership gate, just sign-in.
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
    series_id = quest.get("seriesId") or quest_id
    reviews = []
    for doc in db.collection("questSeries").document(series_id).collection("reviews").stream():
        review = doc.to_dict()
        uid = review.get("uid")
        user_snap = db.collection("users").document(uid).get() if uid else None
        user_data = user_snap.to_dict() if user_snap is not None and user_snap.exists else {}
        created_at = review.get("createdAt")
        event_date = review.get("eventDate")
        reviews.append({
            "uid": uid,
            "name": user_data.get("name"),
            "rating": review.get("rating"),
            "body": review.get("body"),
            "eventDate": event_date.isoformat() if event_date else None,
            "createdAt": created_at.isoformat() if created_at else None,
        })

    reviews.sort(key=lambda r: r["eventDate"] or "", reverse=True)
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
        series_ids = set()
        for quest_doc in db.collection("quests").where("orgId", "==", uid).stream():
            quest = quest_doc.to_dict()
            series_ids.add(quest.get("seriesId") or quest_doc.id)
            _delete_quest(db, quest_doc.reference)
        for series_id in series_ids:
            _delete_series_reviews(db, series_id)
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
