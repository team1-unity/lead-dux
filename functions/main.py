import base64
import calendar
import json
import math
import secrets
from datetime import datetime, timedelta, timezone
from io import BytesIO
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import qrcode
from google import genai
from google.genai import types as genai_types
from firebase_functions import https_fn
from firebase_functions.options import set_global_options
from firebase_admin import auth, firestore, initialize_app
from firebase_admin import storage as admin_storage

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
# The QR belongs to the EVENT, not to a person: an organization generates one
# QR per quest (see generate_event_qr_code) and displays it at the event
# itself (poster, tablet, projector); attendees scan it themselves via
# check_in_to_event. This replaced an earlier per-attendee model (RSVP minted
# a personal QR, the org scanned each attendee) — see git history for that
# version if you need it.
#
# A quest's own doc gets `eventDate` (required) and `eventEndTime` (optional)
# at creation time (see create_quest/create_default_quest below), plus
# `qrToken`/`qrTokenVersion` once an org has generated a QR for it (absent
# until then — no schema migration needed for quests created before this).
# Refreshing the QR mints a new token and bumps the version; the old token
# simply stops matching, invalidating it, while every `attendance` doc
# already recorded (which stores the token it was redeemed with, not a live
# reference to the quest's current one) is left untouched — a refresh can
# never retroactively un-attend someone.
#
# Attendance records live in their own top-level `attendance` collection
# (not nested under quests) — one doc per successful check-in, id
# `{eventId}_{userId}` (see _attendance_doc_id) so "has this person already
# checked in to this event" is a cheap existence read rather than a query.
# This is the canonical source for "did this person attend this quest" —
# list_quest_attendees and submit_review's attendance gate both read it.

DEFAULT_EVENT_WINDOW_HOURS = 6  # used when a quest has no explicit end time

# Point System & Feedback (see AI_README.md) ---------------------------------
#
# Three sources count toward a user's points: a flat amount for completing
# an organization quest, a tiered amount for completing a side/neighborhood
# quest (isDefault, see _validate_tier and the quest-creation functions
# below), both awarded at check-in, and a bonus from organization feedback
# (see submit_quest_feedback_batch further down). Rank (Iron/Bronze/Silver/
# Gold/Diamond, 100 points each) is derived from `points` by _rank_for_points
# below and kept in sync on `users/{uid}.rank` by _award_points every time
# points change — the ladder itself is defined twice on purpose (here and in
# frontend/template/rank.js), once for each side that needs it; keep the
# RANKS/POINTS_PER_RANK values in the two files in sync by hand if they ever
# change.
ORG_QUEST_BASE_POINTS = 20
FEEDBACK_BONUS_BY_RATING = {10: 20, 9: 18, 8: 15, 7: 12, 6: 10, 5: 8, 4: 6, 3: 4, 2: 2, 1: 0}
TIER_BASE_POINTS = {"iron": 10, "bronze": 12, "silver": 15, "gold": 18, "diamond": 20}

RANKS = ["Iron", "Bronze", "Silver", "Gold", "Diamond"]
POINTS_PER_RANK = 100

# A side quest's tier only unlocks once a user's rank reaches it — TIER_BASE_
# POINTS is already keyed iron/bronze/silver/gold/diamond in rank order, so
# it doubles as the tier-unlock order (see _unlocked_tiers) rather than
# needing a second list kept in sync by hand.
#
# Separately, only SIDE_QUEST_CONCURRENT_LIMIT side quests can be RSVP'd-but-
# not-yet-checked-in at once — this nudges someone back toward organization
# quests (the app's primary path) instead of stockpiling every unlocked side
# quest. Completing (or cancelling) one frees a slot; see
# _active_side_quest_ids.
SIDE_QUEST_CONCURRENT_LIMIT = 2


def _unlocked_tiers(rank: str) -> list:
    tiers = list(TIER_BASE_POINTS)
    index = RANKS.index(rank) if rank in RANKS else 0
    return tiers[: index + 1]


def _rank_for_points(points: int) -> str:
    index = min(max(points, 0) // POINTS_PER_RANK, len(RANKS) - 1)
    return RANKS[index]


def _points_to_next_rank(points: int):
    index = min(max(points, 0) // POINTS_PER_RANK, len(RANKS) - 1)
    if index == len(RANKS) - 1:
        return None
    return (index + 1) * POINTS_PER_RANK - max(points, 0)


def _apply_points(transaction, user_ref, amount):
    snap = user_ref.get(transaction=transaction)
    points = (snap.to_dict().get("points", 0) if snap.exists else 0) + amount
    transaction.update(user_ref, {"points": points, "rank": _rank_for_points(points)})


# Awards `amount` points to a user and keeps `rank` in sync with it, as one
# atomic step — a plain read-then-Increment would leave a window where
# another award (e.g. a check-in and a feedback bonus landing close
# together) could compute rank from a stale points value.
def _award_points(db, uid: str, amount: int):
    if amount <= 0:
        return
    firestore.transactional(_apply_points)(db.transaction(), db.collection("users").document(uid), amount)


def _to_utc(value: datetime) -> datetime:
    # Firestore gives back timezone-aware datetimes for Timestamp fields;
    # this just guards against a naive one slipping in some other way.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _qr_expires_at(event_date: datetime, event_end_time: datetime | None) -> datetime:
    if event_end_time is not None:
        return _to_utc(event_end_time)
    return _to_utc(event_date) + timedelta(hours=DEFAULT_EVENT_WINDOW_HOURS)


def _make_qr_data_uri(quest_id: str, token: str, version: int) -> str:
    # No uid in the payload — this QR belongs to the event, not to whoever
    # happens to scan it. `v` (qrTokenVersion) rides along purely as a
    # sanity check for check_in_to_event; the token itself is what actually
    # gets validated (see the constant-time compare there).
    payload = json.dumps({"questId": quest_id, "token": token, "v": version})
    image = qrcode.make(payload)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _attendance_doc_id(event_id: str, uid: str) -> str:
    return f"{event_id}_{uid}"


def _attendance_ref(db, event_id: str, uid: str):
    return db.collection("attendance").document(_attendance_doc_id(event_id, uid))


# A side quest counts as "active" (occupying one of the caller's
# SIDE_QUEST_CONCURRENT_LIMIT slots) as long as they're RSVP'd to it and
# haven't checked in yet — the same "attendance doc existence means
# checked-in" rule check_in_to_event and submit_review already rely on.
# Bounded by however many side quests this one person has ever RSVP'd to,
# not the whole quests collection.
def _active_side_quest_ids(db, uid: str) -> list:
    active = []
    query = db.collection("quests").where("isDefault", "==", True).where("rsvpd", "array_contains", uid)
    for doc in query.stream():
        if not _attendance_ref(db, doc.id, uid).get().exists:
            active.append(doc.id)
    return active


EARTH_RADIUS_KM = 6371  # matches EventsMap.jsx's client-side haversine formula
ACCESSIBLE_QUEST_RADIUS_KM = 25  # ~15.5mi — what counts as "nearby" below


def _haversine_km(lat1, lng1, lat2, lng2):
    # Same formula as frontend/template/EventsMap.jsx's client-side
    # haversineKm — no new dependency needed for a straight-line distance
    # at this app's scale.
    r1, r2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(r1) * math.cos(r2) * math.sin(dlng / 2) ** 2
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# Whether a user who stated accommodationNeeds at onboarding currently has
# enough nearby, fully-matching organization quests to reach their next
# rank purely from those — if not, rsvp_to_quest relaxes
# SIDE_QUEST_CONCURRENT_LIMIT for them (see there), since side quests have
# no physical venue to be inaccessible in the first place. Live, not
# cached: recomputed on every call, so it always reflects the current quest
# catalog rather than a stale onboarding-time snapshot that would go wrong
# as quests get added or removed.
def _has_enough_accessible_org_quests(db, user: dict) -> bool:
    needs = set(user.get("accommodationNeeds") or [])
    if not needs:
        return True  # callers only care when needs is non-empty; safe default otherwise

    points_to_next_rank = _points_to_next_rank(user.get("points", 0))
    if points_to_next_rank is None:
        return True  # already at Diamond — nothing left to rank up into

    user_lat, user_lng = user.get("lat"), user.get("lng")
    if user_lat is None or user_lng is None:
        # No coordinates on file — can't evaluate "nearby" at all, so
        # returning False here (meaning "not enough") errs generous: the
        # caller relaxes the limit rather than silently holding someone to
        # the normal cap just because we can't confirm their situation.
        return False

    quests_needed = math.ceil(points_to_next_rank / ORG_QUEST_BASE_POINTS)
    now = datetime.now(timezone.utc)
    matching_count = 0
    for doc in db.collection("quests").where("isDefault", "==", False).stream():
        quest = doc.to_dict()
        event_date = quest.get("eventDate")
        lat, lng = quest.get("lat"), quest.get("lng")
        if event_date is None or _to_utc(event_date) < now or lat is None or lng is None:
            continue
        if _haversine_km(user_lat, user_lng, lat, lng) > ACCESSIBLE_QUEST_RADIUS_KM:
            continue
        if not needs.issubset(set(quest.get("accommodationTags") or [])):
            continue
        matching_count += 1
        if matching_count >= quests_needed:
            return True
    return matching_count >= quests_needed


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
    # attendance lives in its own top-level collection (not nested under
    # this quest), keyed by eventId — deleting the quest doc doesn't touch
    # those rows automatically, so they're cleaned up explicitly here or
    # they'd sit around orphaned (readable by nobody, but still consuming
    # storage) forever. Small collection at this app's scale, so a plain
    # query+loop is fine; a bulk-delete API would be worth it if quests ever
    # had thousands of attendees each.
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
    for doc in db.collection("attendance").where("eventId", "==", quest_ref.id).stream():
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


# lat/lng always travel with a placeId (see _quest_doc_fields) — the
# frontend captures both from the same Places Autocomplete selection, so a
# request with one but not the other means the client is out of sync with
# this API, not a case worth quietly tolerating.
def _validate_coordinates(lat, lng) -> tuple:
    if isinstance(lat, bool) or isinstance(lng, bool) or not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "lat and lng are required and must be numbers — select a location from the suggestions.",
        )
    return float(lat), float(lng)


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


# Every side/neighborhood (isDefault) quest must declare a difficulty tier —
# that's what its check-in base points come from (see TIER_BASE_POINTS).
# Organization quests never have a tier; they're always the flat
# ORG_QUEST_BASE_POINTS instead.
def _validate_tier(value) -> str:
    if value not in TIER_BASE_POINTS:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"tier must be one of {sorted(TIER_BASE_POINTS)}.",
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
    org_id, org_name, is_default, tier, place_id=None, lat=None, lng=None,
    accommodation_tags=None, accommodation_details=None,
):
    return {
        "title": title,
        "description": description,
        "tags": tags,
        "location": location,
        # Google Place ID for `location`, when it came from Places
        # Autocomplete (organization quests only — see create_quest/
        # create_recurring_quest). Side/default quests never have one:
        # "Your neighborhood" or "Any local park" isn't a specific place,
        # so create_default_quest never collects or validates a location
        # this way and this stays None for them.
        "placeId": place_id,
        # Coordinates for the map view — captured client-side from the same
        # Places Autocomplete selection as placeId (see
        # PlaceAutocompleteInput.jsx), so these two fields always travel
        # together: a quest either has both a placeId and coordinates, or
        # neither. Side/default quests stay None here for the same reason
        # they have no placeId — they're not tied to one point on a map.
        "lat": lat,
        "lng": lng,
        # Which accessibility accommodations this quest offers (e.g.
        # wheelchair-accessible), organization quests only — see
        # ACCOMMODATION_OPTIONS/_validate_accommodation_tags and
        # _has_enough_accessible_org_quests. Side/default quests never set
        # this (self-directed, no physical venue to accommodate). Required
        # (non-empty) at create_quest time for org quests — see there.
        "accommodationTags": accommodation_tags or [],
        # Optional free-text supplement to the tags above — e.g. specific
        # entry instructions. Side/default quests never set this either.
        "accommodationDetails": accommodation_details,
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
        "tier": tier,
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
        "experienceLevel": None,
        "experienceLevelOther": "",
        "timeAvailability": None,
        "timeAvailabilityOther": "",
        "groupPreference": None,
        "groupPreferenceOther": "",
        "motivation": None,
        "motivationOther": "",
        "leaderGoal": "",
        "isSuspended": False,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    auth.set_custom_user_claims(uid, {"role": "onboarding_user"})
    return {"success": True, "role": "onboarding_user"}


# The leadership-profile options submit_onboarding validates against — kept
# server-side (not just in the frontend's leadershipProfile.js) so a
# tampered client can't write a value the recommendation step won't
# recognize. Keep these two vocabularies in sync by hand. "other" is always
# additionally accepted on top of each set below — the frontend's
# ChoiceField appends an "Other" pill to every question, which reveals a
# free-text field (the {field}Other companion) for an answer that isn't one
# of the presets.
EXPERIENCE_LEVELS = {"new", "some", "experienced"}
TIME_AVAILABILITY_OPTIONS = {"monthly", "weekly", "flexible"}
GROUP_PREFERENCES = {"solo", "team", "leading"}
MOTIVATIONS = {"experience", "community", "impact", "requirement"}
MAX_OTHER_LENGTH = 120
MAX_LEADER_GOAL_LENGTH = 280

# Fixed vocabulary for accessibility accommodations — mirrors
# frontend/template/accommodations.js, kept in sync by hand the same way
# the leadership-profile vocabularies above are. A user's accommodationNeeds
# (set here, at onboarding) are matched against a quest's own
# accommodationTags (required at create_quest time — see
# _validate_accommodation_tags/_has_enough_accessible_org_quests below) —
# unlike the leadership-profile questions, this is a multi-select with no
# "Other" (same shape as `interests`), so there's nothing to resolve beyond
# "every value must be one of these."
ACCOMMODATION_OPTIONS = {
    "wheelchair-accessible", "asl-interpretation", "accessible-parking", "sensory-friendly", "elevator-access",
}
ACCOMMODATION_DETAILS_MAX_LENGTH = 500


def _validate_accommodation_tags(value, field_name):
    if not isinstance(value, list):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"{field_name} must be a list.",
        )
    unknown = set(value) - ACCOMMODATION_OPTIONS
    if unknown:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"{field_name} has unknown values: {sorted(unknown)}. Allowed: {sorted(ACCOMMODATION_OPTIONS)}.",
        )
    return value


# Optional free-text supplement to accommodationTags (e.g. "ring the side
# door bell for wheelchair entry") — organization quests only, never
# required (unlike the tags themselves).
def _validate_accommodation_details(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "accommodationDetails must be a string.",
        )
    if len(value) > ACCOMMODATION_DETAILS_MAX_LENGTH:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"accommodationDetails must be at most {ACCOMMODATION_DETAILS_MAX_LENGTH} characters.",
        )
    return value.strip() or None


def _resolve_choice_with_other(value, other_value, known_values, field_name):
    if value == "other":
        if not isinstance(other_value, str) or not other_value.strip():
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                f'{field_name}Other is required when {field_name} is "other".',
            )
        if len(other_value) > MAX_OTHER_LENGTH:
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                f"{field_name}Other must be at most {MAX_OTHER_LENGTH} characters.",
            )
        return "other", other_value.strip()

    if value not in known_values:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f'{field_name} must be one of {sorted(known_values)} or "other".',
        )
    return value, ""


# Callable from the onboarding form, once, right after an onboarding_user
# answers it. Writes to the caller's own doc only — there's no targetUid
# here, unlike set_user_role, so there's nothing to escalate. Graduates the
# caller straight to role "user". Beyond name/age/interests, this also
# collects a short leadership profile (experience level, time availability,
# group preference, motivation, and what kind of leader they want to
# become) — richer signal for a future quest-recommendation step to match
# quests to where someone actually is, not just their interest tags.
@https_fn.on_call()
def submit_onboarding(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "onboarding_user")

    interests = req.data.get("interests")
    age = req.data.get("age")
    name = req.data.get("name")
    location = req.data.get("location")
    place_id = req.data.get("placeId")
    leader_goal = req.data.get("leaderGoal") or ""
    accommodation_needs = _validate_accommodation_tags(req.data.get("accommodationNeeds") or [], "accommodationNeeds")

    if not isinstance(interests, list) or not interests:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "interests must be a non-empty list.",
        )
    # Places Autocomplete-backed, same as an organization's location — see
    # create_quest's module note. Collected here for a future location-
    # based recommendation step (see the AI Integration section of the
    # project proposal), not read/displayed anywhere yet.
    if not location or not place_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "A location must be selected from the suggestions.",
        )
    # Same Places Autocomplete selection as location/placeId (see
    # PlaceAutocompleteInput.jsx) — required alongside them, same reasoning
    # as create_quest's lat/lng requirement. Used by
    # _has_enough_accessible_org_quests to find nearby organization quests
    # for someone with accommodationNeeds; unused otherwise today.
    lat, lng = _validate_coordinates(req.data.get("lat"), req.data.get("lng"))

    experience_level, experience_level_other = _resolve_choice_with_other(
        req.data.get("experienceLevel"), req.data.get("experienceLevelOther"), EXPERIENCE_LEVELS, "experienceLevel",
    )
    time_availability, time_availability_other = _resolve_choice_with_other(
        req.data.get("timeAvailability"), req.data.get("timeAvailabilityOther"), TIME_AVAILABILITY_OPTIONS, "timeAvailability",
    )
    group_preference, group_preference_other = _resolve_choice_with_other(
        req.data.get("groupPreference"), req.data.get("groupPreferenceOther"), GROUP_PREFERENCES, "groupPreference",
    )
    motivation, motivation_other = _resolve_choice_with_other(
        req.data.get("motivation"), req.data.get("motivationOther"), MOTIVATIONS, "motivation",
    )

    if not isinstance(leader_goal, str) or not leader_goal.strip():
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "leaderGoal is required.",
        )
    if len(leader_goal) > MAX_LEADER_GOAL_LENGTH:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"leaderGoal must be at most {MAX_LEADER_GOAL_LENGTH} characters.",
        )

    firestore.client().collection("users").document(req.auth.uid).update({
        "name": name,
        "age": age,
        "location": location,
        "placeId": place_id,
        "lat": lat,
        "lng": lng,
        "interests": interests,
        "accommodationNeeds": accommodation_needs,
        "experienceLevel": experience_level,
        "experienceLevelOther": experience_level_other,
        "timeAvailability": time_availability,
        "timeAvailabilityOther": time_availability_other,
        "groupPreference": group_preference,
        "groupPreferenceOther": group_preference_other,
        "motivation": motivation,
        "motivationOther": motivation_other,
        "leaderGoal": leader_goal.strip(),
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
    place_id = req.data.get("placeId")
    reason = req.data.get("reason")

    if not all([name, phone, location, place_id, reason]):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "name, phone, a location selected from the suggestions, and reason are required.",
        )

    uid = req.auth.uid
    email = (req.auth.token.get("email") or "").lower()
    firestore.client().collection("ORGREQ").document(uid).set({
        "name": name,
        "email": email,
        "phone": phone,
        "location": location,
        "placeId": place_id,
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
        "placeId": request_data.get("placeId"),
        "reason": request_data.get("reason"),
        "ltag": [],
        "etag": [],
        # Getting approved here IS the vetting pass (see the two-step
        # application/manual-review process in the proposal) — there's no
        # separate "mark verified" admin action, approval already implies it.
        "verified": True,
        # Profile fields an org fills in later from its own Profile page
        # (see update_organization_profile) — all optional, defaulted here
        # so every approved org has a consistent doc shape from day one.
        "logoUrl": None,
        "category": None,
        "missionStatement": None,
        "city": None,
        "state": None,
        "website": None,
        "contactEmail": None,
        "socialLinks": {},
        "photos": [],
        # Trust Score rollup (see _record_review) — raw sum/count rather
        # than a derived average, so both the average and the "needs at
        # least 3 reviews" cutoff can be recomputed without replaying history.
        "ratingSum": 0,
        "ratingCount": 0,
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
    place_id = req.data.get("placeId")
    tz = _validate_timezone(req.data.get("timezone"))
    if not title or not description:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "title and description are required.",
        )
    # Places Autocomplete is the only way the frontend's location field
    # produces a value now — a placeId here means the location actually
    # came from a selected place, not arbitrary free text. Organization
    # quests only; create_default_quest never requires this (see its own
    # module note).
    if not place_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "A location must be selected from the suggestions.",
        )
    lat, lng = _validate_coordinates(req.data.get("lat"), req.data.get("lng"))
    # Required so attendees can see what's available before deciding to
    # attend (see QuestDetailBody's accessibility section) — organization
    # quests only, never optional the way plain `tags` is.
    accommodation_tags = _validate_accommodation_tags(req.data.get("accommodationTags") or [], "accommodationTags")
    if not accommodation_tags:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "Select at least one accessibility accommodation for this quest.",
        )
    accommodation_details = _validate_accommodation_details(req.data.get("accommodationDetails"))

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
        org_id=req.auth.uid, org_name=org_name, is_default=False, tier=None, place_id=place_id,
        lat=lat, lng=lng, accommodation_tags=accommodation_tags, accommodation_details=accommodation_details,
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

    is_admin = req.auth.token.get("role") == "admin"
    # Same Places Autocomplete requirement as create_quest, org calls only —
    # an admin using this to create a recurring default (neighborhood)
    # quest never has (or needs) one, same as create_default_quest.
    place_id = req.data.get("placeId")
    if not is_admin and not place_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "A location must be selected from the suggestions.",
        )
    lat, lng = (None, None) if is_admin else _validate_coordinates(req.data.get("lat"), req.data.get("lng"))
    # Required for the org branch only — see create_quest's identical check.
    if is_admin:
        accommodation_tags, accommodation_details = [], None
    else:
        accommodation_tags = _validate_accommodation_tags(req.data.get("accommodationTags") or [], "accommodationTags")
        if not accommodation_tags:
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                "Select at least one accessibility accommodation for this quest.",
            )
        accommodation_details = _validate_accommodation_details(req.data.get("accommodationDetails"))

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
    if is_admin:
        org_id, org_name, is_default = None, "Neighborhood", True
        tier = _validate_tier(req.data.get("tier"))
        place_id = None
    else:
        org_snap = db.collection("organizations").document(req.auth.uid).get()
        org_id, org_name, is_default = req.auth.uid, (org_snap.to_dict().get("name") if org_snap.exists else None), False
        tier = None

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
            org_id=org_id, org_name=org_name, is_default=is_default, tier=tier, place_id=place_id,
            lat=lat, lng=lng, accommodation_tags=accommodation_tags, accommodation_details=accommodation_details,
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
            tier=quest.get("tier"), place_id=quest.get("placeId"),
            lat=quest.get("lat"), lng=quest.get("lng"),
            accommodation_tags=quest.get("accommodationTags"), accommodation_details=quest.get("accommodationDetails"),
        ))
        quest_ids.append(doc_ref.id)
    batch.commit()

    return {"success": True, "seriesId": series_id, "questIds": quest_ids}


# One-time (well — re-runnable, but idempotent) admin utility: every quest
# that has a placeId already had a real place selected via Places
# Autocomplete, but coordinates weren't captured client-side until the map
# view existed (see PlaceAutocompleteInput.jsx). This backfills lat/lng for
# every such quest that's missing them, via a Place Details lookup by the
# placeId it already has — not a fuzzy address geocode, so there's no
# "couldn't find that address" case to design around; the only way this
# fails per-quest is a transient API error or a placeId that's since become
# invalid (e.g. the place closed), which just gets reported back rather
# than blocking the rest of the run. Side/default quests are untouched —
# they never had a placeId to look up in the first place.
@https_fn.on_call(secrets=["GOOGLE_PLACES_SERVER_KEY"])
def backfill_quest_coordinates(req: https_fn.CallableRequest) -> dict:
    _require_admin(req)

    import os
    import urllib.error
    import urllib.request

    api_key = os.environ["GOOGLE_PLACES_SERVER_KEY"]
    db = firestore.client()

    updated = 0
    failed_quest_ids = []
    batch = db.batch()
    pending = 0

    for doc in db.collection("quests").stream():
        data = doc.to_dict()
        place_id = data.get("placeId")
        if not place_id or data.get("lat") is not None:
            continue

        url = f"https://places.googleapis.com/v1/places/{place_id}?fields=location&key={api_key}"
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                result = json.loads(resp.read())
            location = result["location"]
            batch.update(doc.reference, {"lat": location["latitude"], "lng": location["longitude"]})
        except (urllib.error.URLError, KeyError, json.JSONDecodeError):
            failed_quest_ids.append(doc.id)
            continue

        updated += 1
        pending += 1
        # Firestore caps a single batch at 500 writes — flush well under
        # that so a run with more quests than fit in one batch still commits
        # everything instead of raising partway through.
        if pending >= 400:
            batch.commit()
            batch = db.batch()
            pending = 0

    if pending > 0:
        batch.commit()

    return {"success": True, "updated": updated, "failedQuestIds": failed_quest_ids}


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
    tier = _validate_tier(req.data.get("tier"))

    doc_ref = firestore.client().collection("quests").document()
    doc_ref.set(_quest_doc_fields(
        title=title, description=description, tags=tags, location=location, tz=tz,
        capacity=capacity, series_id=doc_ref.id, recurrence_frequency=None, recurrence_until=None,
        event_date=event_date, event_end_time=event_end_time,
        org_id=None, org_name="Neighborhood", is_default=True, tier=tier,
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

    # Side quests are additionally gated by rank (tier unlock) and by how
    # many the caller already has in progress at once (see
    # SIDE_QUEST_CONCURRENT_LIMIT) — neither applies to organization quests.
    # Read-then-decide is fine here (unlike capacity below): both checks are
    # about this one caller's own state, not a value multiple concurrent
    # RSVPs could race over.
    if quest.get("isDefault"):
        user_snap = db.collection("users").document(req.auth.uid).get()
        user = user_snap.to_dict() if user_snap.exists else {}
        points = user.get("points", 0)
        if quest.get("tier") not in _unlocked_tiers(_rank_for_points(points)):
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
                "You haven't unlocked this side quest tier yet.",
            )
        already_rsvpd = req.auth.uid in (quest.get("rsvpd") or [])
        # Someone with accessibility needs who doesn't currently have enough
        # nearby, matching organization quests to rank up skips this limit
        # entirely — side quests are self-directed with no physical venue
        # to be inaccessible in the first place (see
        # _has_enough_accessible_org_quests).
        at_limit = len(_active_side_quest_ids(db, req.auth.uid)) >= SIDE_QUEST_CONCURRENT_LIMIT
        if at_limit and user.get("accommodationNeeds") and not _has_enough_accessible_org_quests(db, user):
            at_limit = False
        if not already_rsvpd and at_limit:
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
                f"You've reached your side quest limit ({SIDE_QUEST_CONCURRENT_LIMIT} at a time). "
                "Complete one of your current side quests, or check out organization quests instead.",
            )

    # Capacity has to be checked and the rsvpd array updated as one atomic
    # step — otherwise two people RSVPing for the last open spot at the
    # same moment could both read "1 spot left" and both get in, same
    # class of race as submit_review's avgRating (see _record_review).
    # Already-RSVP'd is exempted from the capacity check entirely: without
    # that, someone who joined before the quest filled up would get
    # incorrectly rejected on a harmless repeat call.
    firestore.transactional(_record_rsvp)(db.transaction(), ref, req.auth.uid)

    return {"success": True}


# The inverse of rsvp_to_quest — just pulls the uid back out of rsvpd. Any
# attendance record from an earlier check-in is left alone: cancelling an
# RSVP after already attending shouldn't retroactively erase that you did.
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
    return {"success": True}


def _require_owning_org_or_admin_for_quest(req, quest):
    role = req.auth.token.get("role")
    is_owning_org = role == "organization" and quest.get("orgId") == req.auth.uid
    if role != "admin" and not is_owning_org:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            "You can only manage QR codes for your own organization's quests.",
        )


def _get_quest_for_qr(db, quest_id):
    if not quest_id:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "questId is required.")
    ref = db.collection("quests").document(quest_id)
    snap = ref.get()
    if not snap.exists:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, f"No quest {quest_id}.")
    return ref, snap.to_dict()


# Callable from the org dashboard's "Generate QR Code" button (own quests
# only) or the admin dashboard (any quest). Idempotent — if this quest
# already has a token, re-renders it rather than rotating it; rotating is
# refresh_event_qr_code's job specifically, so an accidental double-click
# here never invalidates a code that's already posted somewhere.
@https_fn.on_call()
def generate_event_qr_code(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)
    db = firestore.client()
    ref, quest = _get_quest_for_qr(db, req.data.get("questId"))
    _require_owning_org_or_admin_for_quest(req, quest)

    token = quest.get("qrToken")
    version = quest.get("qrTokenVersion", 0)
    if not token:
        token = secrets.token_urlsafe(24)
        ref.update({"qrToken": token, "qrTokenVersion": version})

    return {"success": True, "qr": _make_qr_data_uri(ref.id, token, version)}


# Callable from the org dashboard's "View QR Code" button — re-renders
# whatever token is currently live without minting or rotating anything.
@https_fn.on_call()
def get_event_qr_code(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)
    db = firestore.client()
    ref, quest = _get_quest_for_qr(db, req.data.get("questId"))
    _require_owning_org_or_admin_for_quest(req, quest)

    token = quest.get("qrToken")
    if not token:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "No QR code has been generated for this quest yet.",
        )

    return {"success": True, "qr": _make_qr_data_uri(ref.id, token, quest.get("qrTokenVersion", 0))}


# Callable from the org dashboard's "Refresh QR Code" button — mints a new
# token and bumps the version, so the previous QR (poster, tablet, whatever
# still has the old image on screen) stops validating. Every `attendance`
# doc already recorded stores the token it was redeemed with, not a live
# pointer to the quest, so existing attendance is never disturbed by this.
@https_fn.on_call()
def refresh_event_qr_code(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)
    db = firestore.client()
    ref, quest = _get_quest_for_qr(db, req.data.get("questId"))
    _require_owning_org_or_admin_for_quest(req, quest)

    token = secrets.token_urlsafe(24)
    version = quest.get("qrTokenVersion", 0) + 1
    ref.update({"qrToken": token, "qrTokenVersion": version})

    return {"success": True, "qr": _make_qr_data_uri(ref.id, token, version)}


# Callable from the new user-facing "Scan QR Code" flow (see
# frontend/template/QuestScanner.jsx) — any signed-in user, not just an
# org/admin, since the whole point of this redesign is that attendees scan
# themselves in. questId/token/v come from decoding the event's QR image
# client-side (see _make_qr_data_uri for the payload shape). Idempotent:
# scanning an already-checked-in code again succeeds with
# alreadyCheckedIn=True rather than erroring, since a double scan is an
# expected accident, not an attack.
@https_fn.on_call()
def check_in_to_event(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)

    quest_id = req.data.get("questId")
    token = req.data.get("token")
    if not quest_id or not token:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId and token are required.",
        )

    db = firestore.client()
    quest_ref, quest = _get_quest_for_qr(db, quest_id)
    uid = req.auth.uid

    stored_token = quest.get("qrToken")
    # Constant-time comparison — this token is a bearer credential, so
    # timing differences on a naive `!=` could in principle leak how many
    # leading characters matched. A quest with no token yet (or one that's
    # been refreshed since this QR was generated) never has a stored_token
    # equal to whatever was scanned, so this same check covers both
    # "invalid code" and "stale/refreshed code" — no separate version check
    # needed at validation time.
    if not stored_token or not secrets.compare_digest(stored_token, token):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            "Invalid or expired QR code.",
        )

    event_date = quest.get("eventDate")
    if event_date is None or datetime.now(timezone.utc) > _to_utc(_qr_expires_at(event_date, quest.get("eventEndTime"))):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "This event's check-in window has closed.",
        )

    if uid not in quest.get("rsvpd", []):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "RSVP to this quest before checking in.",
        )

    attendance_ref = _attendance_ref(db, quest_id, uid)
    existing = attendance_ref.get()
    if existing.exists:
        return {"success": True, "alreadyCheckedIn": True, "pointsAwarded": existing.to_dict().get("pointsAwarded", 0)}

    # Flat points for an organization quest, tiered points for a side/
    # neighborhood one — see the Point System note above ORG_QUEST_BASE_POINTS.
    # A pre-existing side quest with no tier on file (predates that field)
    # simply awards 0. _award_points is the same atomic points+rank helper
    # check_in_attendee used before this redesign — keeps rank in sync with
    # points in one transaction rather than a bare Increment.
    base_points = ORG_QUEST_BASE_POINTS if quest.get("orgId") else TIER_BASE_POINTS.get(quest.get("tier"), 0)
    _award_points(db, uid, base_points)

    attendance_ref.set({
        "userId": uid,
        "orgId": quest.get("orgId"),
        "eventId": quest_id,
        "checkedInAt": firestore.SERVER_TIMESTAMP,
        "pointsAwarded": base_points,
        "qrToken": token,
        "createdAt": firestore.SERVER_TIMESTAMP,
    })

    return {"success": True, "alreadyCheckedIn": False, "pointsAwarded": base_points}


# Quest photo submission & verification --------------------------------------
#
# Proof-of-participation photo — separate from organization feedback/reviews
# below, and from the +5 bonus it can unlock. Doc id is the same
# {questId}_{uid} composite _attendance_doc_id already uses, which is what
# makes "one submission per completed quest" true at the data-model level:
# only one photoSubmissions doc can ever exist for a given (quest, user)
# pair, and a resubmission after rejection overwrites that same doc rather
# than creating a new one.
#
# Eligibility differs by quest type, since only organization quests actually
# have a QR check-in flow:
#   - Organization quest: must already be checked in (an `attendance` doc
#     exists — see check_in_to_event). The photo is extra proof on top of an
#     already-completed quest, so approval awards the flat +5 photo bonus —
#     never the tier's base points, which don't apply to organization quests
#     at all.
#   - Side/default quest: no QR ever exists for these, so accepting the
#     quest (RSVP under the hood — see rsvp_to_quest/cancel_rsvp) is the
#     gate, and approving the photo (see approve_photo_submission) is ITSELF
#     what marks the side quest completed — it creates the `attendance` doc
#     (freeing the caller's SIDE_QUEST_CONCURRENT_LIMIT slot, see
#     _active_side_quest_ids) and awards exactly the tier's base points,
#     never an additional +5 on top (there's no separate "bonus" for side
#     quests — the photo IS the completion mechanism, not an addition to
#     it). A short written reflection is required alongside the photo for
#     side quests only (see PHOTO_REFLECTION_MAX_LENGTH below); organization
#     quests never require or store one.
#
# The binary upload itself never passes through a callable — the client
# uploads straight to Cloud Storage (storage.rules enforces the file-type/
# size limits unconditionally, so a tampered client can't bypass them), and
# submit_quest_photo below only ever receives the resulting storage path.
# It still re-verifies the uploaded blob server-side via the Admin SDK as
# defense in depth, and patches the blob's metadata with the quest's real
# orgId/isDefault (trusted, since it's read from the quest doc, not the
# caller) — that's what lets storage.rules gate reads without needing a
# cross-service lookup at the Firestore doc this function then creates.

PHOTO_BONUS_POINTS = 5
MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024
ALLOWED_PHOTO_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
REJECTION_REASON_MAX_LENGTH = 300
# Side/default quests require a short written reflection alongside the
# photo (see submit_quest_photo below) — organization quests never do,
# since the photo there is extra proof on top of an already-completed
# (checked-in) quest, not the completion signal itself.
PHOTO_REFLECTION_MAX_LENGTH = 1000


def _photo_submission_ref(db, quest_id: str, uid: str):
    return db.collection("photoSubmissions").document(_attendance_doc_id(quest_id, uid))


# Callable from the quest list's photo-upload form, once the file is
# already sitting in Storage at storagePath (see QuestPhotoSubmission.jsx).
@https_fn.on_call()
def submit_quest_photo(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "user")

    quest_id = req.data.get("questId")
    storage_path = req.data.get("storagePath")
    content_type = req.data.get("contentType")
    if not quest_id or not storage_path or not content_type:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId, storagePath, and contentType are required.",
        )
    if content_type not in ALLOWED_PHOTO_CONTENT_TYPES:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"contentType must be one of {sorted(ALLOWED_PHOTO_CONTENT_TYPES)}.",
        )

    uid = req.auth.uid
    # Must be exactly this caller's own folder for this quest — otherwise a
    # tampered client could point storagePath at someone else's upload (or
    # a different quest's) and have it recorded as their own submission.
    expected_prefix = f"photoSubmissions/{_attendance_doc_id(quest_id, uid)}/"
    if not storage_path.startswith(expected_prefix):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "storagePath must be under this quest's own submission folder.",
        )

    db = firestore.client()
    quest = _get_quest_or_404(db, quest_id)

    # Side/default quests have no QR check-in flow at all — RSVP is the
    # whole gate, and the photo (once approved) is what completes it.
    # Organization quests still require an actual check-in first.
    if quest.get("isDefault"):
        if uid not in (quest.get("rsvpd") or []):
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
                "RSVP to this side quest before submitting a photo.",
            )
    elif not _attendance_ref(db, quest_id, uid).get().exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "You can only submit a photo for a quest you've checked in to.",
        )

    reflection = req.data.get("reflection")
    if quest.get("isDefault"):
        if not isinstance(reflection, str) or not reflection.strip():
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                "A short reflection is required to submit a side quest completion.",
            )
        if len(reflection) > PHOTO_REFLECTION_MAX_LENGTH:
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                f"reflection must be at most {PHOTO_REFLECTION_MAX_LENGTH} characters.",
            )
        reflection = reflection.strip()
    else:
        reflection = None

    blob = admin_storage.bucket().blob(storage_path)
    if not blob.exists():
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND,
            "Uploaded photo not found — try uploading again.",
        )
    blob.reload()
    if blob.size is not None and blob.size > MAX_PHOTO_SIZE_BYTES:
        blob.delete()
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"Photo must be smaller than {MAX_PHOTO_SIZE_BYTES // (1024 * 1024)}MB.",
        )
    if blob.content_type not in ALLOWED_PHOTO_CONTENT_TYPES:
        blob.delete()
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "Unsupported photo file type.",
        )

    # Trusted routing info for storage.rules' read check — read from the
    # quest doc server-side, never from anything the caller supplied.
    blob.metadata = {"orgId": quest.get("orgId") or "", "isDefault": str(bool(quest.get("isDefault")))}
    blob.patch()

    ref = _photo_submission_ref(db, quest_id, uid)
    existing_snap = ref.get()
    existing = existing_snap.to_dict() if existing_snap.exists else None
    # A pending or approved submission already occupies this quest's one
    # slot; only a rejected (or no) prior submission can be (re)submitted
    # over.
    if existing and existing.get("status") in ("pending", "approved"):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.ALREADY_EXISTS,
            "You've already submitted a photo for this quest.",
        )

    user_snap = db.collection("users").document(uid).get()
    user_name = user_snap.to_dict().get("name") if user_snap.exists else None

    ref.set({
        "questId": quest_id,
        "userId": uid,
        "orgId": quest.get("orgId"),
        "isDefault": bool(quest.get("isDefault")),
        "questTitle": quest.get("title"),
        "userName": user_name,
        "storagePath": storage_path,
        "contentType": content_type,
        "reflection": reflection,
        "status": "pending",
        "pointsAwarded": 0,
        "rejectionReason": None,
        "reviewedAt": None,
        "reviewedBy": None,
        # Preserved across a resubmission — the first time this quest was
        # ever submitted for stays stable even if it's later rejected and
        # tried again.
        "createdAt": existing.get("createdAt") if existing else firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    return {"success": True, "status": "pending"}


def _record_photo_approval(transaction, ref, reviewer_uid):
    snap = ref.get(transaction=transaction)
    if not snap.exists:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, "No photo submission found.")
    submission = snap.to_dict()
    # Re-checked inside the transaction (not just by the caller before
    # starting it) so two overlapping approve calls — a double-click, or
    # two reviewers in different tabs — can't both award points.
    if submission.get("status") != "pending":
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "Only pending submissions can be approved.",
        )
    transaction.update(ref, {
        "status": "approved",
        "reviewedAt": firestore.SERVER_TIMESTAMP,
        "reviewedBy": reviewer_uid,
    })
    return submission


# Callable from the org dashboard's (own quests) or admin dashboard's (side
# quests) pending-photo queue. Awarding points is a separate step after the
# transaction above commits — same two-step "record, then award" shape
# submit_quest_feedback_batch uses for its own bonus.
#
# The +5 photo bonus (PHOTO_BONUS_POINTS) only ever applies to organization
# quests, which already earned their flat base points at check-in — the
# photo there really is an extra bonus on top. Side/default quests have no
# such bonus: they have no QR check-in at all (see the module note above
# submit_quest_photo), so approving the photo IS the quest's completion
# moment, and it awards exactly the tier's own base points (Iron = 10
# total, not 10 + 5) — it also creates the attendance doc, freeing the
# submitter's SIDE_QUEST_CONCURRENT_LIMIT slot (see _active_side_quest_ids).
# If an admin separately generated a QR for this side quest and the
# submitter already checked in through it, those points were already
# awarded there, so approval awards nothing further (never double-counted).
@https_fn.on_call()
def approve_photo_submission(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "organization", "admin")

    quest_id = req.data.get("questId")
    user_id = req.data.get("userId")
    if not quest_id or not user_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId and userId are required.",
        )

    db = firestore.client()
    quest = _get_quest_or_404(db, quest_id)
    _require_owning_org_or_admin(req, quest, "review photo submissions")

    ref = _photo_submission_ref(db, quest_id, user_id)
    submission = firestore.transactional(_record_photo_approval)(db.transaction(), ref, req.auth.uid)
    submitter_uid = submission["userId"]

    if quest.get("isDefault"):
        attendance_ref = _attendance_ref(db, quest_id, submitter_uid)
        if attendance_ref.get().exists:
            total_points = 0
        else:
            total_points = TIER_BASE_POINTS.get(quest.get("tier"), 0)
            attendance_ref.set({
                "userId": submitter_uid,
                "orgId": None,
                "eventId": quest_id,
                "checkedInAt": firestore.SERVER_TIMESTAMP,
                "pointsAwarded": total_points,
                "qrToken": None,
                "createdAt": firestore.SERVER_TIMESTAMP,
            })
    else:
        total_points = PHOTO_BONUS_POINTS

    _award_points(db, submitter_uid, total_points)
    ref.update({"pointsAwarded": total_points})

    return {"success": True}


# Callable from the same pending-photo queues as approve_photo_submission.
# Rejecting an already-approved submission (clawing back points) is out of
# scope — only a currently-pending one can be rejected. The submitter can
# resubmit afterward (see submit_quest_photo).
@https_fn.on_call()
def reject_photo_submission(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "organization", "admin")

    quest_id = req.data.get("questId")
    user_id = req.data.get("userId")
    reason = req.data.get("reason")
    if not quest_id or not user_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId and userId are required.",
        )
    if reason is not None and (not isinstance(reason, str) or len(reason) > REJECTION_REASON_MAX_LENGTH):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"reason must be a string of at most {REJECTION_REASON_MAX_LENGTH} characters.",
        )

    db = firestore.client()
    quest = _get_quest_or_404(db, quest_id)
    _require_owning_org_or_admin(req, quest, "review photo submissions")

    ref = _photo_submission_ref(db, quest_id, user_id)
    snap = ref.get()
    if not snap.exists:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, "No photo submission found.")
    if snap.to_dict().get("status") != "pending":
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "Only pending submissions can be rejected.",
        )

    ref.update({
        "status": "rejected",
        "reviewedAt": firestore.SERVER_TIMESTAMP,
        "reviewedBy": req.auth.uid,
        "rejectionReason": (reason.strip() if isinstance(reason, str) and reason.strip() else None),
    })
    return {"success": True}


# Organization feedback & reflections journal --------------------------------
#
# The reverse direction from a review: here the ORGANIZATION rates and
# messages an individual attendee about their own performance on a specific
# quest (1-10, see FEEDBACK_BONUS_BY_RATING above), rather than the attendee
# reviewing the org. Feedback lives at users/{uid}/feedback/{questId} — one
# doc per person per quest occurrence, self-readable directly via the client
# SDK (see firestore.rules) since there's nothing sensitive in it, unlike
# attendance tokens. Writing it is still Cloud-Function-only, same as every
# other collection. `notified` gates the one-time "you got feedback" popup
# (frontend/template/FeedbackToast.jsx); `read` gates the BottomNav journal
# badge — the two are deliberately separate, since dismissing the popup
# shouldn't itself mark the journal entry as read.
#
# Writing feedback is a two-step flow: generate_quest_feedback_drafts uses
# Gemini (Google's free-tier-eligible API — see the GEMINI_API_KEY secret
# below) to write a first-pass rating+message per checked-in attendee (so an
# org with many attendees doesn't have to write N messages from scratch),
# then the org reviews/edits in the frontend and submit_quest_feedback_batch
# persists whatever it actually decided to send. Nothing is written to
# Firestore until that second step.

FEEDBACK_MESSAGE_MAX_LENGTH = 600
DEFAULT_FEEDBACK_RATING = 10

_FEEDBACK_DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "feedback": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "uid": {"type": "string"},
                    "message": {"type": "string"},
                },
                "required": ["uid", "message"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["feedback"],
    "additionalProperties": False,
}


def _require_owning_org_or_admin(req: https_fn.CallableRequest, quest: dict, action: str):
    role = req.auth.token.get("role")
    is_owning_org = role == "organization" and quest.get("orgId") == req.auth.uid
    if role != "admin" and not is_owning_org:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            f"You can only {action} for your own organization's quests.",
        )


def _get_quest_or_404(db, quest_id: str) -> dict:
    snap = db.collection("quests").document(quest_id).get()
    if not snap.exists:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, f"No quest {quest_id}.")
    return snap.to_dict()


# Callable from the org dashboard's "Give Feedback" button on a quest (own
# quests only, or admin for any). Every checked-in attendee who doesn't
# already have a feedback doc for this quest gets a draft — the org's own
# name is never sent to Gemini, only the quest's title/description and each
# attendee's name, so the model has nothing to invent specific actions from
# and is told not to. Ratings default to the max (10); the org can lower
# any of them, or edit any message, before anything is actually sent (see
# submit_quest_feedback_batch). Nothing is persisted here — this only
# returns a proposal.
@https_fn.on_call(secrets=["GEMINI_API_KEY"])
def generate_quest_feedback_drafts(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "organization", "admin")

    quest_id = req.data.get("questId")
    if not quest_id:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "questId is required.")

    db = firestore.client()
    quest = _get_quest_or_404(db, quest_id)
    _require_owning_org_or_admin(req, quest, "generate feedback")

    if not quest.get("orgId"):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "This quest has no organization to give feedback as.",
        )

    already_given = set(quest.get("feedbackGivenUids") or [])
    attendees = []
    # Attendance lives in its own top-level collection now (see
    # check_in_to_event) — existence for (eventId, uid) means checked-in.
    for doc in db.collection("attendance").where("eventId", "==", quest_id).stream():
        uid = doc.to_dict()["userId"]
        if uid in already_given:
            continue
        user_snap = db.collection("users").document(uid).get()
        name = (user_snap.to_dict().get("name") if user_snap.exists else None) or "there"
        attendees.append({"uid": uid, "name": name})

    if not attendees:
        return {"questTitle": quest.get("title"), "attendees": []}

    people_lines = "\n".join(f'- uid "{a["uid"]}": {a["name"]}' for a in attendees)
    prompt = (
        f'Write a short (2-3 sentence), warm, encouraging feedback message for each of the '
        f'following people, who each just completed the community quest "{quest.get("title")}" '
        f'({quest.get("description")}).\n\n'
        f"Vary the phrasing, structure, and opening line across people so the set doesn't read like "
        f"a mail-merge template with names swapped in. You don't know what any specific person "
        f"actually did during the quest — don't invent specific actions or achievements for them. "
        f"Keep each message grounded in the quest itself and a genuine tone of thanks.\n\n"
        f"People:\n{people_lines}\n\n"
        f'Return one entry per person in `feedback`, each with that exact `uid` value copied back '
        f"and your generated `message`."
    )

    # genai.Client() reads GEMINI_API_KEY from the environment on its own —
    # created here, not at module level, so a missing/misconfigured secret
    # only breaks this one function's cold start, not every function in
    # this file (see the ORG_QUEST_BASE_POINTS module note for the same
    # reasoning applied to Firestore access elsewhere).
    #
    # NOTE for whoever touches this next: ai.google.dev's own docs (as of
    # this writing) describe a client.interactions.create(...) method that
    # doesn't match what the google-genai SDK's own GitHub README documents
    # (client.models.generate_content(...), used below) — sourced from the
    # README since it's tied directly to the installed package version,
    # not a docs page that may be ahead of or behind it. Worth
    # re-verifying if this starts throwing AttributeErrors after a SDK
    # upgrade.
    client = genai.Client()
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=genai_types.GenerateContentConfig(
            max_output_tokens=2048,
            response_mime_type="application/json",
            response_json_schema=_FEEDBACK_DRAFT_SCHEMA,
        ),
    )
    text = response.text
    if not text:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INTERNAL,
            "The AI didn't return any feedback drafts. Try again.",
        )
    messages_by_uid = {item["uid"]: item["message"] for item in json.loads(text).get("feedback", [])}

    return {
        "questTitle": quest.get("title"),
        "attendees": [
            {
                "uid": a["uid"],
                "name": a["name"],
                "rating": DEFAULT_FEEDBACK_RATING,
                "message": messages_by_uid.get(a["uid"], ""),
            }
            for a in attendees
        ],
    }


# Callable from the org dashboard, once the org has reviewed (and possibly
# edited) the drafts from generate_quest_feedback_drafts. Persists exactly
# what's passed in — an entry for a uid that isn't actually a checked-in
# attendee, or one that already has feedback for this quest, is silently
# skipped (stale UI, not necessarily tampering) rather than failing the
# whole batch; a malformed rating/message DOES fail the whole batch, since
# that can only come from a broken client, not a stale one.
@https_fn.on_call()
def submit_quest_feedback_batch(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "organization", "admin")

    quest_id = req.data.get("questId")
    feedback_list = req.data.get("feedback")
    if not quest_id or not isinstance(feedback_list, list) or not feedback_list:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "questId and a non-empty feedback list are required.",
        )

    db = firestore.client()
    quest_ref = db.collection("quests").document(quest_id)
    quest = _get_quest_or_404(db, quest_id)
    _require_owning_org_or_admin(req, quest, "submit feedback")

    # Attendance now lives in its own top-level collection (see
    # check_in_to_event) — its mere existence for (eventId, uid) means
    # checked-in, there's no separate status field to filter on anymore.
    checked_in_uids = {
        doc.to_dict()["userId"]
        for doc in db.collection("attendance").where("eventId", "==", quest_id).stream()
    }
    already_given = set(quest.get("feedbackGivenUids") or [])

    # Validate every entry before writing anything — a malformed entry must
    # fail the whole request with nothing persisted (see the module note
    # above), including no points awarded. Points are applied via
    # _award_points (its own transaction, for the same points+rank atomicity
    # as check_in_attendee) only after the feedback-doc batch below has
    # actually committed.
    valid_entries = []
    for entry in feedback_list:
        uid = entry.get("uid")
        if uid not in checked_in_uids or uid in already_given:
            continue

        rating = entry.get("rating")
        message = entry.get("message")
        if isinstance(rating, bool) or not isinstance(rating, int) or rating not in FEEDBACK_BONUS_BY_RATING:
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                "rating must be an integer between 1 and 10.",
            )
        if not isinstance(message, str) or not message.strip():
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                "message is required for every entry.",
            )
        if len(message) > FEEDBACK_MESSAGE_MAX_LENGTH:
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                f"message must be at most {FEEDBACK_MESSAGE_MAX_LENGTH} characters.",
            )
        valid_entries.append((uid, rating, message.strip()))

    batch = db.batch()
    sent_uids = []
    for uid, rating, message in valid_entries:
        bonus = FEEDBACK_BONUS_BY_RATING[rating]
        feedback_ref = db.collection("users").document(uid).collection("feedback").document(quest_id)
        batch.set(feedback_ref, {
            "questId": quest_id,
            "questTitle": quest.get("title"),
            "seriesId": quest.get("seriesId") or quest_id,
            "orgId": quest.get("orgId"),
            "orgName": quest.get("orgName"),
            "rating": rating,
            "message": message,
            "pointsAwarded": bonus,
            "notified": False,
            "read": False,
            "reflectionBody": "",
            "reflectionUpdatedAt": None,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
        sent_uids.append(uid)

    if sent_uids:
        batch.update(quest_ref, {"feedbackGivenUids": firestore.ArrayUnion(sent_uids)})
        batch.commit()
        for uid, rating, _ in valid_entries:
            _award_points(db, uid, FEEDBACK_BONUS_BY_RATING[rating])

    return {"success": True, "sentUids": sent_uids}


# Callable from the frontend's live feedback popup, the moment it's shown —
# flips `notified` so the same feedback doesn't pop up again on a later page
# load. Deliberately separate from `read` (see module note above): dismissing
# or acting on the popup shouldn't also clear the journal's unread badge for
# an entry the user hasn't actually opened yet.
@https_fn.on_call()
def mark_feedback_notified(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)
    quest_id = req.data.get("questId")
    if not quest_id:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "questId is required.")
    firestore.client().collection("users").document(req.auth.uid).collection("feedback").document(quest_id).update({
        "notified": True,
    })
    return {"success": True}


# Callable from the Journal page when a user opens a specific entry — clears
# that entry's contribution to the BottomNav badge count.
@https_fn.on_call()
def mark_feedback_read(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)
    quest_id = req.data.get("questId")
    if not quest_id:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "questId is required.")
    firestore.client().collection("users").document(req.auth.uid).collection("feedback").document(quest_id).update({
        "read": True,
    })
    return {"success": True}


REFLECTION_MAX_LENGTH = 4000


# Callable from the Journal page's reflection textarea. Requires the
# feedback doc to already exist — reflections are written in response to
# organization feedback, not before it. Purely private (see firestore.rules:
# only the owner or an admin can ever read it); doesn't affect rank.
@https_fn.on_call()
def submit_quest_reflection(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)

    quest_id = req.data.get("questId")
    body = req.data.get("body")
    if not quest_id:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "questId is required.")
    if not isinstance(body, str) or len(body) > REFLECTION_MAX_LENGTH:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"body must be a string of at most {REFLECTION_MAX_LENGTH} characters.",
        )

    ref = firestore.client().collection("users").document(req.auth.uid).collection("feedback").document(quest_id)
    if not ref.get().exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND,
            "No feedback found for this quest yet.",
        )
    ref.update({"reflectionBody": body.strip(), "reflectionUpdatedAt": firestore.SERVER_TIMESTAMP})
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

    attendance_by_uid = {
        doc.to_dict()["userId"]: doc.to_dict()
        for doc in db.collection("attendance").where("eventId", "==", quest_id).stream()
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
            "status": "checked_in" if attendance else "rsvpd",
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


def _record_review(transaction, series_ref, review_ref, org_ref, rating, body, uid, quest_id, event_date):
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

    # Organization Trust Score — a straight running sum/count (not a
    # derived average like the series aggregate above) so both the average
    # and the "needs at least 3 reviews before it's shown" cutoff (see
    # OrganizationProfile) can be recomputed from these two raw numbers
    # without replaying every review ever left across all of an org's
    # quests. Every quest this transaction can reach always has an orgId
    # (submit_review rejects orgless quests before calling this), so
    # org_ref always points at a real approved organization doc.
    org = org_ref.get(transaction=transaction).to_dict() or {}
    transaction.set(org_ref, {
        "ratingSum": org.get("ratingSum", 0) + rating,
        "ratingCount": org.get("ratingCount", 0) + 1,
    }, merge=True)


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
    # An attendance doc's mere existence means checked-in now (see
    # check_in_to_event) — there's no separate "rsvpd but not yet attended"
    # status stored in this collection anymore.
    attended = _attendance_ref(db, quest_id, req.auth.uid).get().exists
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
    org_ref = db.collection("organizations").document(quest["orgId"])
    # firestore.transactional is applied here, at call time, rather than as
    # a decorator on _record_review's def — a decorator would bind to
    # whichever `firestore` module is in scope at import time, permanently,
    # which breaks swapping in the fake Firestore client tests use.
    firestore.transactional(_record_review)(
        db.transaction(), series_ref, review_ref, org_ref, rating, body.strip(), req.auth.uid, quest_id, quest.get("eventDate"),
    )

    return {"success": True}


# Callable from the quest list — lets a member see their own review for
# this specific occurrence (e.g. after navigating away and back), same
# self-only shape as update_interests. No targetUid, so there's nothing to
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


SOCIAL_LINK_KEYS = {"instagram", "facebook", "twitter", "linkedin", "tiktok", "youtube"}
# Every field here is optional — an org fills these in whenever it wants
# from its own Profile page (see OrgProfileEditor), separate from ltag/etag
# above and from the minimal name/phone/location/reason collected at
# signup (see submit_organization_request). Only a field actually present
# in req.data gets validated/written, so a partial edit (e.g. just adding a
# website) doesn't require resending every other field.
def _validate_social_links(value):
    if not isinstance(value, dict):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "socialLinks must be an object.",
        )
    unknown = set(value) - SOCIAL_LINK_KEYS
    if unknown:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"socialLinks has unknown keys: {sorted(unknown)}. Allowed: {sorted(SOCIAL_LINK_KEYS)}.",
        )
    if not all(isinstance(v, str) for v in value.values()):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "Every socialLinks value must be a string.",
        )
    return {k: v for k, v in value.items() if v}


# Callable from the org's own Profile page — the public-facing fields
# rendered on OrganizationProfile (logo, mission, location, contact,
# socials). Organization Profile itself is otherwise a public-within-app
# read (see the loosened organizations/{uid} read rule in firestore.rules);
# writing any of it is still Cloud-Function-only, same as every other
# collection.
_SIMPLE_PROFILE_FIELDS = ("logoUrl", "category", "missionStatement", "city", "state", "website", "contactEmail")

@https_fn.on_call()
def update_organization_profile(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "organization")

    update = {"updatedAt": firestore.SERVER_TIMESTAMP}
    for field in _SIMPLE_PROFILE_FIELDS:
        if field not in req.data:
            continue
        value = req.data.get(field)
        if value is not None and not isinstance(value, str):
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                f"{field} must be a string or null.",
            )
        update[field] = value

    if "socialLinks" in req.data:
        update["socialLinks"] = _validate_social_links(req.data.get("socialLinks"))

    firestore.client().collection("organizations").document(req.auth.uid).update(update)
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


# Callable from Profile — lets an already-onboarded "user" change their
# accommodation needs and/or location after the fact (onboarding only ever
# sets them once). Unlike update_interests, an empty accommodationNeeds list
# is valid (it means "no needs anymore"), and location/placeId/lat/lng are
# only touched when actually present in the request — see
# update_organization_profile above for the same "present key = change it"
# shape. Both feed _has_enough_accessible_org_quests, so keeping them
# current matters for the side-quest-limit relaxation, not just display.
@https_fn.on_call()
def update_accommodation_needs(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "user")

    update = {"updatedAt": firestore.SERVER_TIMESTAMP}

    if "accommodationNeeds" in req.data:
        update["accommodationNeeds"] = _validate_accommodation_tags(
            req.data.get("accommodationNeeds") or [], "accommodationNeeds"
        )

    location_keys = ("location", "placeId", "lat", "lng")
    if any(key in req.data for key in location_keys):
        location = req.data.get("location")
        place_id = req.data.get("placeId")
        if not isinstance(location, str) or not location.strip() or not isinstance(place_id, str) or not place_id.strip():
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                "location and placeId are required together with lat/lng.",
            )
        lat, lng = _validate_coordinates(req.data.get("lat"), req.data.get("lng"))
        update["location"] = location
        update["placeId"] = place_id
        update["lat"] = lat
        update["lng"] = lng

    if len(update) == 1:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "Provide accommodationNeeds and/or a location to update.",
        )

    firestore.client().collection("users").document(req.auth.uid).update(update)
    return {"success": True}


# Rank progression -------------------------------------------------------
#
# Points themselves are only ever touched by _award_points (check-in,
# feedback bonus); everything below just reads/reports off of them, or
# (issue_certificate) manages the one piece of state that isn't derived
# from points at all.

# Callable from Profile. Self by default; targetUid lets the admin
# dashboard's Diamond panel look up someone else's rank without exposing
# every user's points to every other user via firestore.rules. Recomputes
# from `points` rather than trusting the stored `rank` field, so this stays
# correct even if `rank` were ever missing or stale.
@https_fn.on_call()
def get_user_rank(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)

    target_uid = req.data.get("targetUid") or req.auth.uid
    if target_uid != req.auth.uid and req.auth.token.get("role") != "admin":
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            "You can only look up your own rank.",
        )

    snap = firestore.client().collection("users").document(target_uid).get()
    points = snap.to_dict().get("points", 0) if snap.exists else 0
    return {
        "points": points,
        "rank": _rank_for_points(points),
        "pointsToNextRank": _points_to_next_rank(points),
    }


# Callable from the quest list — self-only (same shape as get_user_rank's
# default case) so the frontend can gray out side quests the caller either
# hasn't unlocked yet (tier above their rank) or can't take on right now
# (already at SIDE_QUEST_CONCURRENT_LIMIT active ones), with a message
# explaining which and a way back to organization quests. rsvp_to_quest
# enforces the same two rules server-side — this just exposes the "why"
# ahead of time instead of the frontend finding out from a failed RSVP.
@https_fn.on_call()
def get_side_quest_status(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "user")

    db = firestore.client()
    snap = db.collection("users").document(req.auth.uid).get()
    user = snap.to_dict() if snap.exists else {}
    points = user.get("points", 0)
    active_ids = _active_side_quest_ids(db, req.auth.uid)
    at_limit = len(active_ids) >= SIDE_QUEST_CONCURRENT_LIMIT
    # Same relaxation rsvp_to_quest enforces — see
    # _has_enough_accessible_org_quests. limit/atLimit go to None/False
    # together so the frontend's existing sideQuestGate (keyed off atLimit)
    # just stops gating, no separate "why" messaging needed there.
    relaxed = at_limit and bool(user.get("accommodationNeeds")) and not _has_enough_accessible_org_quests(db, user)

    return {
        "unlockedTiers": _unlocked_tiers(_rank_for_points(points)),
        "activeSideQuestIds": active_ids,
        "limit": None if relaxed else SIDE_QUEST_CONCURRENT_LIMIT,
        "atLimit": False if relaxed else at_limit,
    }


# Callable from the admin dashboard's Diamond Certifications panel — the
# "admin can see once a user reaches the last rank" requirement. Reads off
# the `rank` field itself (rather than recomputing per-user, get_user_rank
# style) since that's the whole reason `rank` is persisted at all: no other
# way to ask Firestore "which users are at Diamond" without one.
@https_fn.on_call()
def list_diamond_users(req: https_fn.CallableRequest) -> dict:
    _require_admin(req)

    users = []
    for doc in firestore.client().collection("users").where("rank", "==", "Diamond").stream():
        data = doc.to_dict()
        users.append({
            "uid": doc.id,
            "name": data.get("name"),
            "email": data.get("email"),
            "points": data.get("points", 0),
            "certificateIssued": bool(data.get("certificateIssued")),
            "certificateIssuedAt": data.get("certificateIssuedAt"),
        })
    return {"users": users}


# Callable from the admin dashboard's "Issue Certificate" button — per the
# proposal, certificates are never issued automatically, only by an admin
# choosing to for a specific person. Idempotent: re-issuing (e.g. the admin
# double-clicks) never moves certificateIssuedAt once it's set, so the
# certificate's own displayed award date stays stable.
@https_fn.on_call()
def issue_certificate(req: https_fn.CallableRequest) -> dict:
    _require_admin(req)

    target_uid = req.data.get("targetUid")
    if not target_uid:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "targetUid is required.",
        )

    user_ref = firestore.client().collection("users").document(target_uid)
    snap = user_ref.get()
    if not snap.exists:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, f"No user {target_uid}.")

    data = snap.to_dict()
    if _rank_for_points(data.get("points", 0)) != "Diamond":
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "This user hasn't reached Diamond rank yet.",
        )

    update = {"certificateIssued": True}
    if not data.get("certificateIssuedAt"):
        update["certificateIssuedAt"] = firestore.SERVER_TIMESTAMP
    user_ref.update(update)
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
