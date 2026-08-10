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

# Must match frontend/template/tagTones.js's DUCK_AVATAR_VARIANTS.length —
# kept in sync by hand, same as TONE_HEX/style.css already are (see that
# file's own note). This is the fixed warm-pastel duck-mascot palette
# organizations without a logoUrl fall back to (see OrgAvatar.jsx).
DUCK_AVATAR_COLOR_COUNT = 18

# The event QR encodes a real URL (see _make_qr_data_uri) rather than a raw
# JSON payload, specifically so it's scannable by a phone's own native
# camera app, not just this app's in-app scanner (QuestScanner.jsx) —
# whichever one decodes it just opens/navigates to this same link, landing
# on CheckInConfirm.jsx. Hardcoded to the real production Hosting URL
# (this project's one deployment, per .firebaserc) rather than derived from
# the request — there's no "request origin" to derive it from here, this
# runs once at QR-generation time, for a code that's meant to be printed/
# displayed at a real in-person event either way.
CHECKIN_BASE_URL = "https://lead-dux.web.app"

# Point System & Feedback (see AI_README.md) ---------------------------------
#
# Three sources count toward a user's points: a flat amount for completing
# an organization quest, a tiered amount for completing a side/neighborhood
# quest (isDefault, see _validate_tier and the quest-creation functions
# below), both awarded at check-in, and a flat bonus from a leader-requested
# feedback response that scores well (see submit_feedback_request_response
# further down — a leader requests it, the org answers a fixed 5-question
# form, and a passing average awards FEEDBACK_BONUS_POINTS flat, not a
# graduated amount). Rank (Iron/Bronze/Silver/Gold/Diamond, 100 points each)
# is derived from `points` by _rank_for_points below and kept in sync on
# `users/{uid}.rank` by _award_points every time points change — the ladder
# itself is defined twice on purpose (here and in frontend/template/rank.js),
# once for each side that needs it; keep the RANKS/POINTS_PER_RANK values in
# the two files in sync by hand if they ever change.
ORG_QUEST_BASE_POINTS = 20
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


def _check_in_url(quest_id: str, token: str) -> str:
    # No uid in the URL — this QR belongs to the event, not to whoever
    # happens to scan it. qrTokenVersion doesn't ride along here (it never
    # actually gated anything in check_in_to_event — only the token itself
    # is validated, via the constant-time compare there); a stale/refreshed
    # QR is already caught by the token simply no longer matching. Split out
    # from _make_qr_data_uri as its own pure function so the URL shape
    # itself is directly unit-testable without decoding a rendered QR image
    # back to text (this repo has no QR-decoding dependency, only qrcode
    # for encoding).
    return f"{CHECKIN_BASE_URL}/check-in/{quest_id}/{token}"


def _make_qr_data_uri(quest_id: str, token: str) -> str:
    image = qrcode.make(_check_in_url(quest_id, token))
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
    #
    # Each attendee's feedbackRequests doc and journal entry for this one
    # occurrence are keyed by questId too, so they'd be orphaned the same
    # way if not cleaned up here alongside attendance — same reasoning as
    # the module note above, just for the newer feedback-request/journal
    # collections rather than attendance itself.
    for doc in db.collection("attendance").where("eventId", "==", quest_ref.id).stream():
        uid = doc.to_dict().get("userId")
        if uid:
            _feedback_request_ref(db, quest_ref.id, uid).delete()
            _journal_ref(db, uid, quest_ref.id).delete()
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


# Fields _quest_doc_fields gives every occurrence of a series identically at
# creation time (title/description/tags/location/.../timezone — see there),
# as opposed to eventDate/eventEndTime/rsvpd/qrToken/..., which are
# genuinely per-occurrence. update_quest (below) only ever writes to the one
# doc it's called with — without re-applying this same subset to every
# sibling occurrence too, editing e.g. a typo in the title on one date would
# silently desync it from the rest of the series, a state creation itself
# never allows to happen.
_SHARED_SERIES_FIELDS = {
    "title", "description", "tags", "location", "placeId", "lat", "lng",
    "capacity", "accommodationTags", "accommodationDetails", "tier", "timezone",
}


# update_quest's own "did eventDate actually change" check needs this, not
# raw equality — the org's edit form can only ever express/round-trip a
# date down to whole-minute precision (see naturalDate.js's
# fullWallClockPartsInZone, which formats year/month/day/hour/minute only,
# no seconds), but a quest's *stored* eventDate can carry real sub-minute
# precision (e.g. seed_demo_data.py's NOW = datetime.now(timezone.utc) —
# whatever real seconds/microseconds happened to be on the clock when the
# script ran). Comparing raw datetimes meant simply opening a seeded
# quest's edit form and saving *any* unrelated field (description,
# capacity, tags — nothing date-related) silently re-sent that same
# minute with its seconds zeroed out, which read as a genuine reschedule
# and wiped every existing RSVP with no warning — the frontend's own
# "this will clear RSVPs" confirmation never fired either, since *it*
# compares the same seconds-less display string before/after and saw no
# change. Truncating both sides to the minute here is what the frontend
# can actually promise to detect, so that's the only precision this
# comparison should ever care about.
def _truncate_to_minute(value):
    return value.replace(second=0, microsecond=0) if value else value


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
        # Minted fresh per occurrence (one token per quest doc, not shared
        # across a series) so an org's QR code is ready to display the
        # moment a quest exists — see generate_event_qr_code, which still
        # mints on demand as a fallback for anything created before this
        # field existed.
        "qrToken": secrets.token_urlsafe(24),
        "qrTokenVersion": 0,
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

# The illustrated duck characters a member can pick for their own avatar
# fallback (see UserAvatar.jsx/duckSkins.js on the frontend, and
# update_user_profile below) — "duck1" (straw hat) is the default for
# anyone who hasn't picked one yet. Whitelisted server-side so a client
# can't write an arbitrary string here.
DUCK_SKINS = {"duck1", "duck2", "duck3", "duck4"}


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

    db = firestore.client()
    db.collection("users").document(req.auth.uid).update({
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
    # First time interests/location/accommodationNeeds exist for this user —
    # see _refresh_quest_recommendations above.
    _refresh_quest_recommendations(db, req.auth.uid)
    return {"success": True, "role": "user"}


# Callable from WelcomeTour.jsx, the moment a first-time leader or
# organization dismisses (or finishes) the one-time feature walkthrough
# shown right after they land on their real home screen. Flips `introSeen`
# so it never shows again — written to whichever collection actually holds
# this account's own profile doc (users/{uid} for a leader/pending_org,
# organizations/{uid} for an organization) rather than a separate
# collection, since nothing else needs this flag to live alongside it.
# Both collections are already owner-readable (see firestore.rules), so no
# rules change was needed to add this field.
@https_fn.on_call()
def mark_intro_seen(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)
    collection = "organizations" if req.auth.token.get("role") == "organization" else "users"
    firestore.client().collection(collection).document(req.auth.uid).update({"introSeen": True})
    return {"success": True}


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


# Assigns each organization a stable index into DUCK_AVATAR_COLOR_COUNT
# colors — which of the frontend's fixed DUCK_AVATAR_VARIANTS (see
# tagTones.js) its duck-mascot avatar uses whenever it has no logoUrl.
# Idempotent by uid: an org that's already been assigned one keeps it
# (so re-running the demo seeder never reshuffles anyone's color) — only a
# uid with no organizations/{uid} doc yet, or one whose doc predates this
# field, gets a fresh pick: whichever index the fewest current
# organizations hold (ties broken toward the lowest index). While any slot
# is still completely unused its count is 0, so it always wins first,
# handing out 0..DUCK_AVATAR_COLOR_COUNT-1 in order with no two orgs ever
# sharing one. Once every slot has at least one org on it, uniqueness isn't
# possible with a fixed palette this size — but the
# least-used slot still keeps overflow assignments spread as evenly as
# possible instead of all colliding on one color (an earlier version of
# this picked the fallback from the org doc *count*, which doesn't change
# when re-assigning an *existing* org, silently handing every overflow org
# calling it in the same run the identical index).
def _assign_duck_color_index(db, uid: str) -> int:
    org_snap = db.collection("organizations").document(uid).get()
    if org_snap.exists:
        current = org_snap.to_dict().get("duckColorIndex")
        if current is not None:
            return current

    counts = [0] * DUCK_AVATAR_COLOR_COUNT
    for doc in db.collection("organizations").stream():
        idx = doc.to_dict().get("duckColorIndex")
        if idx is not None:
            counts[idx % DUCK_AVATAR_COLOR_COUNT] += 1
    return counts.index(min(counts))


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
    duck_color_index = _assign_duck_color_index(db, target_uid)
    db.collection("organizations").document(target_uid).set({
        "name": request_data.get("name"),
        "email": request_data.get("email"),
        "phone": request_data.get("phone"),
        "location": request_data.get("location"),
        "placeId": request_data.get("placeId"),
        "reason": request_data.get("reason"),
        "ltag": [],
        "etag": [],
        # Trust Score starts at 0 (see AI_README.md) — reviewCount/avgRating
        # are otherwise only ever set by _record_review's merge=True, which
        # would leave them entirely absent from a fresh org's doc until its
        # first review.
        "reviewCount": 0,
        "avgRating": 0,
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
        "website": None,
        "contactEmail": None,
        "socialLinks": {},
        "photos": [],
        "duckColorIndex": duck_color_index,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    req_ref.update({"status": "approved"})
    auth.set_custom_user_claims(target_uid, {"role": "organization"})
    _notify_user(db, target_uid, kind="org_approved")

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
    _delete_org_host_reflections(db, target_uid)
    db.collection("organizations").document(target_uid).delete()
    series_ids = set()
    for quest_doc in db.collection("quests").where("orgId", "==", target_uid).stream():
        quest = quest_doc.to_dict()
        series_ids.add(quest.get("seriesId") or quest_doc.id)
        for uid in quest.get("rsvpd") or []:
            _notify_user(db, uid, kind="quest_cancelled", quest_id=quest_doc.id, quest_title=quest.get("title"))
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


# Callable from the admin dashboard's "organizations" list. Unlike
# list_organization_trust_tags, admin sees the real reviewCount/avgRating/
# trustScore regardless of the TRUST_SCORE_MIN_REVIEWS gate, plus a computed
# `flagged` — an org whose Trust Score has settled at or below
# TRUST_SCORE_FLAG_THRESHOLD once it has enough reviews to be meaningful
# (see AI_README.md's "Organizations with consistently low scores are
# flagged for internal review"). Neither trustScore nor flagged is stored —
# both are cheap to recompute on every read, and storing them would mean
# remembering to update them from _record_review too.
@https_fn.on_call()
def admin_list_organizations(req: https_fn.CallableRequest) -> dict:
    _require_admin(req)

    orgs = []
    for doc in firestore.client().collection("organizations").stream():
        org = doc.to_dict()
        review_count = org.get("reviewCount", 0)
        avg_rating = org.get("avgRating", 0)
        trust_score = _trust_score(avg_rating)
        flagged = _trust_status(review_count, avg_rating) == "under_review"
        orgs.append({"uid": doc.id, **org, "trustScore": trust_score, "flagged": flagged})
    return {"organizations": orgs}


# Callable from the org dashboard's "create quest" form.
@https_fn.on_call()
def create_quest(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "organization")

    title = req.data.get("title")
    # Optional — the document-style create-quest form treats title as the
    # only required field; description is free to be left blank.
    description = req.data.get("description") or ""
    tags = req.data.get("tags") or []
    location = req.data.get("location") or ""
    place_id = req.data.get("placeId")
    tz = _validate_timezone(req.data.get("timezone"))
    if not title:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "title is required.",
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
    # Optional — see create_quest's module note on this.
    description = req.data.get("description") or ""
    tags = req.data.get("tags") or []
    location = req.data.get("location") or ""
    tz = _validate_timezone(req.data.get("timezone"))
    if not title:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "title is required.",
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
        # See create_default_quest's module note — orgName None, not the
        # literal "Neighborhood", so the detail card's org-name line stays
        # hidden instead of stating the obvious.
        org_id, org_name, is_default = None, None, True
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


# Callable from the org/admin quest-edit form's Recurring section (see
# CreateQuestForm.jsx — this used to be permanently read-only once a series
# existed; update_quest's own module note explains why frequency/until
# still can't be touched from *that* function specifically, but editing a
# pattern is exactly what this one is for instead).
#
# Diffs the new frequency/until against whichever occurrences already
# exist for this series and adds/removes dates to match — anchored to the
# series' own first (earliest) occurrence, which never moves; only
# frequency/until change. Past occurrences (already happened) are never
# touched regardless of the new pattern — they're historical record, not
# something a schedule change should be able to retroactively rewrite, the
# same "this date vs. the whole series" granularity delete_quest/
# delete_quest_series already draw.
#
# Blocks the whole update (nothing partially applies) if any occurrence
# that the new pattern would remove already has at least one RSVP —
# silently dropping someone's RSVP because an org shortened a series is
# worse than telling the org to sort those out first (cancel that date
# individually via delete_quest, or wait for attendees to un-RSVP) before
# shrinking the series around them.
@https_fn.on_call()
def update_recurring_series(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)

    series_id = req.data.get("seriesId")
    if not series_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "seriesId is required.",
        )

    db = firestore.client()
    occurrence_docs = list(db.collection("quests").where("seriesId", "==", series_id).stream())
    if not occurrence_docs:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND,
            f"No series {series_id}.",
        )
    quests_by_id = {doc.id: doc.to_dict() for doc in occurrence_docs}
    first = min(quests_by_id.values(), key=lambda q: q["eventDate"])

    role = req.auth.token.get("role")
    is_owning_org = role == "organization" and first.get("orgId") == req.auth.uid
    if role != "admin" and not is_owning_org:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            "You can only edit your own organization's quests.",
        )

    tz = first.get("timezone") or "UTC"
    zone = ZoneInfo(tz)
    frequency = _validate_frequency(req.data.get("frequency"))
    until = _parse_event_datetime(req.data.get("until"), "until", tz)
    target_dates = _generate_series_dates(first["eventDate"], frequency, until, tz)
    target_date_keys = {d.astimezone(zone).date() for d in target_dates}

    now = datetime.now(timezone.utc)
    existing_by_date_key = {
        quest["eventDate"].astimezone(zone).date(): (doc_id, quest)
        for doc_id, quest in quests_by_id.items()
    }

    # Only ever consider occurrences that haven't happened yet — a past
    # date missing from the new pattern isn't "removed," it already
    # happened under whatever pattern was in effect at the time.
    to_remove = [
        (doc_id, quest)
        for date_key, (doc_id, quest) in existing_by_date_key.items()
        if quest["eventDate"] >= now and date_key not in target_date_keys
    ]
    conflicts = [(doc_id, quest) for doc_id, quest in to_remove if quest.get("rsvpd")]
    if conflicts:
        details = "; ".join(
            f"{quest['eventDate'].astimezone(zone).strftime('%b %-d, %Y')} "
            f"({len(quest['rsvpd'])} RSVP'd)"
            for _, quest in conflicts
        )
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            f"Can't shrink this series — these dates already have RSVPs: {details}. "
            "Cancel those dates individually first, then try again.",
        )

    to_add = [
        d for d in target_dates
        if d >= now and d.astimezone(zone).date() not in existing_by_date_key
    ]
    duration = (
        first["eventEndTime"] - first["eventDate"]
        if first.get("eventEndTime") is not None
        else None
    )

    # Not batched with the writes below — _delete_quest's own attendance/
    # feedback/journal cleanup queries don't compose with an in-flight
    # batch (same reason delete_quest_series loops plain deletes instead
    # of batching them). Every occurrence here is already confirmed
    # rsvpd-free above, so there's nothing time-sensitive about doing
    # these one at a time first.
    for doc_id, _quest in to_remove:
        _delete_quest(db, db.collection("quests").document(doc_id))

    removed_ids = {doc_id for doc_id, _quest in to_remove}
    batch = db.batch()
    for occurrence_date in to_add:
        doc_ref = db.collection("quests").document()
        occurrence_end = occurrence_date + duration if duration is not None else None
        batch.set(doc_ref, _quest_doc_fields(
            title=first["title"], description=first["description"], tags=first.get("tags", []),
            location=first.get("location", ""), tz=tz, capacity=first.get("capacity"),
            series_id=series_id, recurrence_frequency=frequency, recurrence_until=until,
            event_date=occurrence_date, event_end_time=occurrence_end,
            org_id=first.get("orgId"), org_name=first.get("orgName"), is_default=first.get("isDefault", False),
            tier=first.get("tier"), place_id=first.get("placeId"),
            lat=first.get("lat"), lng=first.get("lng"),
            accommodation_tags=first.get("accommodationTags"), accommodation_details=first.get("accommodationDetails"),
        ))
    # Every doc in a series shares recurrenceFrequency/recurrenceUntil (see
    # _quest_doc_fields) — including the ones just removed would be
    # redundant, and past occurrences get updated too so nothing in the
    # series is left pointing at a stale pattern.
    for doc_id in quests_by_id:
        if doc_id in removed_ids:
            continue
        batch.update(db.collection("quests").document(doc_id), {
            "recurrenceFrequency": frequency,
            "recurrenceUntil": until,
        })
    batch.commit()

    return {"success": True, "added": len(to_add), "removed": len(to_remove)}


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

    # Optional — a one-off side quest is a self-directed personal challenge,
    # not a scheduled event, so unlike every other create_* function there's
    # no date to require here. Left blank, isUpcoming() (questSeries.js)
    # already treats a quest with no eventDate as always current rather
    # than expiring it. (A *recurring* side quest still needs a start date
    # to generate its occurrences from — see create_recurring_quest, which
    # keeps eventDate required.)
    event_date = (
        _parse_event_datetime(req.data.get("eventDate"), "eventDate", tz)
        if req.data.get("eventDate")
        else None
    )
    event_end_time = (
        _parse_event_datetime(req.data.get("eventEndTime"), "eventEndTime", tz)
        if req.data.get("eventEndTime")
        else None
    )
    if event_date and event_end_time is not None and event_end_time <= event_date:
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
        # No parent org — orgName stays None (not the literal "Neighborhood"
        # this used to be) so the member detail card's org-name line just
        # doesn't render at all (see QuestDetailBody in mobile/Quests.jsx),
        # rather than displaying a label that only restates "this is a side
        # quest."
        org_id=None, org_name=None, is_default=True, tier=tier,
    ))
    return {"success": True, "questId": doc_ref.id}


# Callable from the org/admin quest-edit form — the pencil icon on a quest's
# detail view (previously always disabled; see CreateQuestForm.jsx's edit
# mode). Edits ONE occurrence, same granularity delete already draws
# between "this date" and "the whole series" — a recurring series' overall
# pattern (frequency/until) isn't editable here.
#
# Every field is optional in the payload (only what's actually present gets
# validated/written) EXCEPT questId, so a caller can submit just the one
# thing that changed rather than the whole quest every time.
#
# eventDate is the one field where "editable" has a real consequence: unlike
# every other field, changing it invalidates whatever plans existing
# RSVPs represent (an attendee, an org, or a QR check-in window all assume
# the date on file is the real one) — so a changed eventDate clears
# `rsvpd` back to empty and notifies whoever was on it (see _notify_user),
# telling them to RSVP again if they still want to attend. This mirrors
# what delete_quest/delete_quest_series/keep-only-this-date do for an
# outright cancellation, just for a reschedule instead.
@https_fn.on_call()
def update_quest(req: https_fn.CallableRequest) -> dict:
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
    quest = snap.to_dict()

    role = req.auth.token.get("role")
    is_owning_org = role == "organization" and quest.get("orgId") == req.auth.uid
    if role != "admin" and not is_owning_org:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            "You can only edit your own organization's quests.",
        )

    tz = _validate_timezone(req.data.get("timezone")) if "timezone" in req.data else (quest.get("timezone") or "UTC")

    update = {"updatedAt": firestore.SERVER_TIMESTAMP}

    if "title" in req.data:
        title = req.data.get("title")
        if not title:
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                "title is required.",
            )
        update["title"] = title

    if "description" in req.data:
        update["description"] = req.data.get("description") or ""

    if "tags" in req.data:
        update["tags"] = req.data.get("tags") or []

    # location/placeId/lat/lng always travel together (see create_quest's
    # own module note) — present if any of them is.
    if "location" in req.data or "placeId" in req.data:
        location = req.data.get("location") or ""
        place_id = req.data.get("placeId")
        if not quest.get("isDefault") and not place_id:
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                "A location must be selected from the suggestions.",
            )
        lat, lng = _validate_coordinates(req.data.get("lat"), req.data.get("lng"))
        update["location"] = location
        update["placeId"] = place_id
        update["lat"] = lat
        update["lng"] = lng

    if "capacity" in req.data:
        capacity = _validate_capacity(req.data.get("capacity"))
        current_rsvp_count = len(quest.get("rsvpd") or [])
        if capacity is not None and capacity < current_rsvp_count:
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                f"Capacity can't be set below the current {current_rsvp_count} RSVPs.",
            )
        update["capacity"] = capacity

    if not quest.get("isDefault"):
        if "accommodationTags" in req.data:
            accommodation_tags = _validate_accommodation_tags(
                req.data.get("accommodationTags") or [], "accommodationTags",
            )
            if not accommodation_tags:
                raise https_fn.HttpsError(
                    https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                    "Select at least one accessibility accommodation for this quest.",
                )
            update["accommodationTags"] = accommodation_tags
        if "accommodationDetails" in req.data:
            update["accommodationDetails"] = _validate_accommodation_details(req.data.get("accommodationDetails"))
    elif "tier" in req.data:
        update["tier"] = _validate_tier(req.data.get("tier"))

    # The effective event_date after this update — either the new one being
    # set below, or whatever's already on the doc — is what eventEndTime
    # gets validated against, regardless of which of the two actually
    # changed this call.
    effective_event_date = quest.get("eventDate")
    reschedule_notify_uids = []
    old_event_date = None
    if "eventDate" in req.data:
        new_event_date = (
            _parse_event_datetime(req.data.get("eventDate"), "eventDate", tz)
            if req.data.get("eventDate")
            else None
        )
        old_event_date = quest.get("eventDate")
        if _truncate_to_minute(new_event_date) != _truncate_to_minute(old_event_date):
            update["eventDate"] = new_event_date
            # Side quests can go from having a date to having none (or vice
            # versa) freely — create_default_quest already treats a missing
            # date as normal for them. Org quests always have one; nothing
            # here re-enforces that specifically since the frontend form is
            # what actually decides which fields a given quest type shows.
            update["rsvpd"] = []
            reschedule_notify_uids = list(quest.get("rsvpd") or [])
        effective_event_date = new_event_date

    if "eventEndTime" in req.data:
        new_event_end_time = (
            _parse_event_datetime(req.data.get("eventEndTime"), "eventEndTime", tz)
            if req.data.get("eventEndTime")
            else None
        )
        if new_event_end_time is not None and effective_event_date is not None and new_event_end_time <= effective_event_date:
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                "eventEndTime must be after eventDate.",
            )
        update["eventEndTime"] = new_event_end_time

    if "timezone" in req.data:
        update["timezone"] = tz

    ref.update(update)

    # Propagate whichever shared fields this edit touched to every other
    # occurrence in the same series — see _SHARED_SERIES_FIELDS above. A
    # standalone quest's seriesId is just its own doc id (see the module
    # note near _quest_doc_fields), so the sibling query below naturally
    # finds nothing extra for it.
    shared_update = {k: v for k, v in update.items() if k in _SHARED_SERIES_FIELDS}
    if shared_update:
        series_id = quest.get("seriesId") or quest_id
        siblings = [
            doc for doc in db.collection("quests").where("seriesId", "==", series_id).stream()
            if doc.id != quest_id
        ]
        if siblings:
            batch = db.batch()
            for doc in siblings:
                batch.update(doc.reference, shared_update)
            batch.commit()

    if reschedule_notify_uids:
        notice_title = update.get("title", quest.get("title"))
        for uid in reschedule_notify_uids:
            _notify_user(
                db, uid, kind="quest_rescheduled", quest_id=quest_id, quest_title=notice_title,
                extra={"oldEventDate": old_event_date, "newEventDate": update.get("eventDate")},
            )

    return {"success": True}


# Shared by add_quest_series_cover_photo/remove_quest_series_cover_photo
# below — a series has no single "owner" doc of its own to check ownership
# against (questSeries/{seriesId} only exists once someone's added a review
# or a cover photo), so ownership is checked against any one occurrence in
# the series instead.
def _require_owning_org_or_admin_for_series(db, series_id: str, req: https_fn.CallableRequest):
    quest_snap = next(iter(db.collection("quests").where("seriesId", "==", series_id).limit(1).stream()), None)
    if quest_snap is None:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, f"No quest series {series_id}.")
    quest = quest_snap.to_dict()

    role = req.auth.token.get("role")
    is_owning_org = role == "organization" and quest.get("orgId") == req.auth.uid
    if role != "admin" and not is_owning_org:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            "You can only edit your own organization's quests.",
        )


# Callable from CreateQuestForm.jsx — adds one photo to a quest series' own
# cover-photo gallery. Lives on questSeries/{seriesId} rather than duplicated
# across every occurrence's own quests/{id} doc: a series' cover photos are
# one shared set, the same level reviews already aggregate at (see
# submit_review's own note on this doc), not something that could ever drift
# between dates the way per-occurrence fields (capacity, RSVPs) legitimately
# can. An org can add as many as it wants — no cap here, same as
# organizations.photos (add_organization_photo) has none either.
#
# coverPhotos holds resolved download URLs, not Storage paths — same "store
# the plain URL" choice organizations.logoUrl already made (see
# update_organization_profile), since every reader here (questSeries.js's
# attachSeriesRatings) needs to render the first one synchronously across a
# whole list of quests, not resolve a path per card. merge=True since a
# series with no reviews or cover photos yet has no questSeries doc at all
# (same reasoning as submit_review's own merge=True there) — set() would
# otherwise fail outright on a series that's never been rated.
@https_fn.on_call()
def add_quest_series_cover_photo(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "organization", "admin")

    series_id = req.data.get("seriesId")
    cover_photo_url = req.data.get("coverPhotoUrl")
    if not series_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "seriesId is required.",
        )
    if not isinstance(cover_photo_url, str) or not cover_photo_url:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "coverPhotoUrl is required.",
        )

    db = firestore.client()
    _require_owning_org_or_admin_for_series(db, series_id, req)

    db.collection("questSeries").document(series_id).set(
        {"coverPhotos": firestore.ArrayUnion([cover_photo_url])}, merge=True,
    )
    return {"success": True}


# Callable from CreateQuestForm.jsx — removes one photo from a quest
# series' cover-photo gallery (see add_quest_series_cover_photo above).
@https_fn.on_call()
def remove_quest_series_cover_photo(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "organization", "admin")

    series_id = req.data.get("seriesId")
    cover_photo_url = req.data.get("coverPhotoUrl")
    if not series_id or not cover_photo_url:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "seriesId and coverPhotoUrl are required.",
        )

    db = firestore.client()
    _require_owning_org_or_admin_for_series(db, series_id, req)

    db.collection("questSeries").document(series_id).set(
        {"coverPhotos": firestore.ArrayRemove([cover_photo_url])}, merge=True,
    )
    return {"success": True}


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
    quest = snap.to_dict()

    role = req.auth.token.get("role")
    is_owning_org = role == "organization" and quest.get("orgId") == req.auth.uid
    if role != "admin" and not is_owning_org:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            "You can only delete your own organization's quests.",
        )

    rsvpd = list(quest.get("rsvpd") or [])
    _delete_quest(db, ref)
    for uid in rsvpd:
        _notify_user(db, uid, kind="quest_cancelled", quest_id=quest_id, quest_title=quest.get("title"))
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
    # Each occurrence has its own rsvpd (RSVP is per-date, not per-series),
    # so notifications are gathered per occurrence actually deleted below —
    # the one occurrence kept (if any) isn't cancelled, so its own RSVPs
    # aren't touched or notified.
    notify = []  # [(uid, questId, title)]
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
        occurrence = doc.to_dict()
        for uid in occurrence.get("rsvpd") or []:
            notify.append((uid, doc.id, occurrence.get("title")))
        _delete_quest(db, doc.reference)
        deleted_count += 1

    for uid, occurrence_id, title in notify:
        _notify_user(db, uid, kind="quest_cancelled", quest_id=occurrence_id, quest_title=title)

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
#
# A cold start here (a fresh container loading this whole module —
# including the qrcode and genai SDKs this function never touches) can add
# several seconds on top of the couple of Firestore round-trips this
# actually needs. min_instances=1 would keep one instance warm to avoid
# that, at the cost of paying for it to sit idle 24/7 instead of scaling to
# zero like every other function here — deliberately left at the file's
# default (0) for now pending a decision on that tradeoff.
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

    return {"success": True, "qr": _make_qr_data_uri(ref.id, token)}


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

    return {"success": True, "qr": _make_qr_data_uri(ref.id, token)}


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

    return {"success": True, "qr": _make_qr_data_uri(ref.id, token)}


# Callable from CheckInConfirm.jsx (frontend/app/src) — any signed-in user,
# not just an org/admin, since the whole point of this redesign is that
# attendees scan themselves in. That page is reached either by opening the
# event QR's own URL directly (any camera app can scan it — see
# _make_qr_data_uri) or via this app's own in-app scanner
# (frontend/template/QuestScanner.jsx), which just decodes the same URL and
# navigates there instead of calling this itself. Idempotent: scanning an
# already-checked-in code again succeeds with alreadyCheckedIn=True rather
# than erroring, since a double scan is an expected accident, not an attack.
#
# Same cold-start tradeoff as rsvp_to_quest above (check-in is at least as
# frequent a tap) — left at the default (min_instances=0) for the same
# reason, pending a decision on the recurring cost of keeping it warm.
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

    # A private journal entry for this occurrence, created the moment
    # check-in happens — organization quests only (side quests have no org
    # to request feedback from, and get their own reflection at photo-
    # submission time instead, see submit_quest_photo). `requestStatus`
    # starts unset (not "pending") since no feedback has been requested
    # yet; `read` is deliberately left off the doc entirely rather than
    # defaulted, so BottomNav's `==false` query (see the "Organization
    # feedback requests" module note below) never matches a quest with no
    # feedback on it.
    if quest.get("orgId"):
        db.collection("users").document(uid).collection("journal").document(quest_id).set({
            "questId": quest_id,
            "questTitle": quest.get("title"),
            "seriesId": quest.get("seriesId") or quest_id,
            "orgId": quest.get("orgId"),
            "orgName": quest.get("orgName"),
            "eventDate": quest.get("eventDate"),
            "reflectionBody": "",
            "reflectionUpdatedAt": None,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "requestStatus": None,
        }, merge=True)

    attendance_ref.set({
        "userId": uid,
        "orgId": quest.get("orgId"),
        "eventId": quest_id,
        "checkedInAt": firestore.SERVER_TIMESTAMP,
        "pointsAwarded": base_points,
        "qrToken": token,
        "createdAt": firestore.SERVER_TIMESTAMP,
    })
    _record_quest_attended(db, uid, quest.get("tags") or [])

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
    user_ref = db.collection("users").document(uid)
    # These two don't depend on each other's result — one round-trip via
    # get_all instead of two serial .get()s. Matched by reference rather
    # than by list position, since get_all doesn't guarantee returning
    # snapshots in the same order as the refs passed in.
    existing_snap = user_snap = None
    for snap in db.get_all([ref, user_ref]):
        if snap.reference == ref:
            existing_snap = snap
        else:
            user_snap = snap

    existing = existing_snap.to_dict() if existing_snap.exists else None
    # A pending or approved submission already occupies this quest's one
    # slot; only a rejected (or no) prior submission can be (re)submitted
    # over.
    if existing and existing.get("status") in ("pending", "approved"):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.ALREADY_EXISTS,
            "You've already submitted a photo for this quest.",
        )

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
# submit_feedback_request_response uses for its own bonus.
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
            _record_quest_attended(db, submitter_uid, quest.get("tags") or [])
    else:
        total_points = PHOTO_BONUS_POINTS

    _award_points(db, submitter_uid, total_points)
    ref.update({"pointsAwarded": total_points})

    # Auto-fill the leader's journal cover photo from their own just-
    # approved proof photo — organization quests only (side quests have no
    # journal entry at all; see check_in_to_event's own note on that).
    # Waits for approval rather than doing this at submission time: an
    # org can still reject a submission, and a rejected/unverified photo
    # shouldn't already be sitting as the journal's cover by then. Only
    # when the entry doesn't already have a real photo of its own — a
    # picture someone deliberately chose (set_journal_thumbnail) always
    # wins, and stays untouched by a later approval. Stored as the plain
    # Storage path rather than a resolved download URL (unlike the
    # curated-URL case set_journal_thumbnail otherwise expects) — same
    # "resolve it client-side, same as any other Storage path" precedent
    # HeroCarousel.jsx/PendingPhotoReview.jsx already use for org photos.
    #
    # TODO once a default placeholder background exists: that default
    # should count as "blank" here too, the same way an unset thumbnailUrl
    # already does.
    if quest.get("orgId"):
        journal_ref = _journal_ref(db, submitter_uid, quest_id)
        journal_snap = journal_ref.get()
        if journal_snap.exists and not journal_snap.to_dict().get("thumbnailUrl"):
            journal_ref.update({"thumbnailUrl": submission["storagePath"]})

    # Optional "keep this for my gallery" choice, made right here at
    # approval time instead of requiring a second trip to the approved-
    # submissions list (see add_submission_to_gallery, which still exists
    # for exactly that later-decision case). Org-owned quests only — a side
    # quest's orgId is always None, and admin review of one never carries
    # this flag from the frontend anyway (see PendingPhotoSubmissions.jsx's
    # allowGalleryKeep), but the orgId/role/ownership check here is what
    # actually enforces it, not just frontend intent.
    if (
        bool(req.data.get("addToGallery"))
        and quest.get("orgId")
        and req.auth.token.get("role") == "organization"
        and quest.get("orgId") == req.auth.uid
    ):
        _promote_submission_to_gallery(ref, submission, req.auth.uid)

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


# Organization feedback requests & reflections journal -----------------------
#
# The reverse direction from a review: here the ORGANIZATION assesses an
# individual attendee's own performance on a specific quest, rather than the
# attendee reviewing the org — but unlike a review, this only ever happens
# when the LEADER asks for it (request_quest_feedback), not automatically.
# A leader who feels good about how a specific occurrence went can request
# feedback on it; the org then answers a fixed 5-question form (each 1-10,
# FEEDBACK_QUESTIONS below) covering engagement/presence/involvement, plus
# an optional free-text note (submit_feedback_request_response). The
# resulting average, if it clears FEEDBACK_SCORE_THRESHOLD, awards a flat
# FEEDBACK_BONUS_POINTS bonus on top of the check-in attendance points —
# this is a rare, opt-in bonus, not a routine per-quest payout.
#
# The request itself lives at feedbackRequests/{questId}_{uid} (doc id via
# _attendance_doc_id, same convention as photoSubmissions) — a top-level
# collection, not nested under the user, so the owning org can query across
# every attendee who's requested feedback for its quests (see
# frontend/template/PendingFeedbackRequests.jsx and the firestore.rules
# entry mirroring photoSubmissions'). At most one such doc ever exists per
# (quest, uid) pair — a leader gets exactly one shot at feedback per
# occurrence, request_quest_feedback checks existence (not status) to
# enforce that even after a request has expired or completed.
#
# A leader's private journal entry, at users/{uid}/journal/{questId}, is
# created independently at check-in time (see check_in_to_event) — it no
# longer depends on feedback existing at all. request_quest_feedback and
# submit_feedback_request_response both additionally mirror the request's
# state onto that same journal doc (requestStatus/requestedAt/expiresAt,
# then answers/score/summary/growthArea/extraThoughts/pointsAwarded/
# completedAt) so the mobile Journal page and the BottomNav badge only
# ever need to watch users/{uid}/journal — never feedbackRequests
# directly. `read` gates the BottomNav journal badge — left unset on the
# journal doc until a request actually completes (see check_in_to_event
# and the module note there) rather than defaulted to some value, since a
# Firestore `==false` query never matches a doc where the field is simply
# absent — exactly the behavior wanted for a quest with no feedback on it.
# The one-time "you got feedback" notice is a separate concern entirely —
# submit_feedback_request_response also calls _notify_user (kind=
# "feedback_received"), the same users/{uid}/notifications mechanism
# quest_rescheduled/quest_cancelled already use, surfaced by
# NotificationBanner.jsx on the member Home screen.

FEEDBACK_REQUEST_WINDOW_DAYS = 14  # how long a pending request stays answerable
FEEDBACK_REQUEST_MONTHLY_CAP = 3  # completed requests per calendar month, per leader
FEEDBACK_SCORE_THRESHOLD = 6  # average (out of 10) needed to earn the bonus
FEEDBACK_BONUS_POINTS = 20  # flat — deliberately not graduated by score
EXTRA_THOUGHTS_MAX_LENGTH = 800

# The org-facing question text doubles as the source of truth for which
# answer keys are valid — request_quest_feedback/submit_feedback_request_
# response both validate against this dict's keys rather than a separate
# list, so there's exactly one place to add/reword a question.
FEEDBACK_QUESTIONS = {
    "engagement": "How actively did they participate and engage during the quest?",
    "presence": "How present and attentive were they throughout?",
    "involvement": "How involved were they in contributing to the group or task?",
    "initiative": "How much initiative did they show — stepping up or helping without being asked?",
    "attitude": "How positive and cooperative was their attitude?",
}

# The leader-facing label for each FEEDBACK_QUESTIONS key — what
# _generate_feedback_summary below tells Gemini to call each category,
# and what the prompt's own "mention each category exactly once" rule is
# checked against. Never shown as a number; see that function's own note.
FEEDBACK_CATEGORY_LABELS = {
    "engagement": "Participation & Engagement",
    "presence": "Presence & Attentiveness",
    "involvement": "Contribution",
    "initiative": "Initiative",
    "attitude": "Attitude & Cooperation",
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


def _feedback_request_ref(db, quest_id: str, uid: str):
    return db.collection("feedbackRequests").document(_attendance_doc_id(quest_id, uid))


def _journal_ref(db, uid: str, quest_id: str):
    return db.collection("users").document(uid).collection("journal").document(quest_id)


def _month_start(now: datetime) -> datetime:
    # A completed request counts toward whichever calendar month its
    # completedAt falls in — deliberately not the month it was originally
    # requested in (see the module note above and the cap-recheck in
    # submit_feedback_request_response, which relies on this same anchor).
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _completed_feedback_requests_this_month(db, uid: str) -> int:
    # Filters completedAt in Python rather than via a third `.where(...)`
    # clause — a leader's own completed-request count is small enough that
    # streaming all of it and filtering here is simpler than a three-field
    # composite index for what's otherwise just a two-equality-field query
    # (uid, status) already needed elsewhere.
    month_start = _month_start(datetime.now(timezone.utc))
    query = db.collection("feedbackRequests").where("uid", "==", uid).where("status", "==", "completed")
    return sum(1 for doc in query.stream() if _to_utc(doc.to_dict()["completedAt"]) >= month_start)


# Callable from the mobile Journal page — a leader requesting feedback on
# one specific occurrence they attended, because they felt good about how
# it went. Capped at FEEDBACK_REQUEST_MONTHLY_CAP *completed* requests per
# calendar month (see submit_feedback_request_response for why a pending
# request doesn't itself consume a slot, and how that's still enforced
# without letting several orgs' pending responses stack past the cap).
@https_fn.on_call()
def request_quest_feedback(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "user")

    quest_id = req.data.get("questId")
    if not quest_id:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "questId is required.")

    db = firestore.client()
    uid = req.auth.uid
    quest = _get_quest_or_404(db, quest_id)
    if not quest.get("orgId"):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "This quest has no organization to request feedback from.",
        )

    if not _attendance_ref(db, quest_id, uid).get().exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "You can only request feedback for a quest you actually checked into.",
        )

    request_ref = _feedback_request_ref(db, quest_id, uid)
    if request_ref.get().exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "You've already requested feedback for this quest.",
        )

    if _completed_feedback_requests_this_month(db, uid) >= FEEDBACK_REQUEST_MONTHLY_CAP:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            f"You've already received {FEEDBACK_REQUEST_MONTHLY_CAP} pieces of feedback this month. Try again next month.",
        )

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=FEEDBACK_REQUEST_WINDOW_DAYS)

    # Denormalized here (Admin SDK reads bypass firestore.rules) because
    # the org reviewing this request can't read the leader's users/{uid}
    # doc directly — that collection only allows a user to read their own
    # doc (or an admin). Without this, the org-side UI has no way to show
    # who a pending request is for.
    requester_snap = db.collection("users").document(uid).get()
    requester_name = requester_snap.to_dict().get("name") if requester_snap.exists else None

    batch = db.batch()
    batch.set(request_ref, {
        "questId": quest_id,
        "uid": uid,
        "requesterName": requester_name,
        "orgId": quest.get("orgId"),
        "orgName": quest.get("orgName"),
        "questTitle": quest.get("title"),
        "eventDate": quest.get("eventDate"),
        "requestedAt": firestore.SERVER_TIMESTAMP,
        "expiresAt": expires_at,
        "status": "pending",
        "answers": None,
        "extraThoughts": None,
        "score": None,
        "pointsAwarded": 0,
        "completedAt": None,
    })
    batch.update(_journal_ref(db, uid, quest_id), {
        "requestStatus": "pending",
        "requestedAt": firestore.SERVER_TIMESTAMP,
        "expiresAt": expires_at,
    })
    batch.commit()

    return {"success": True, "expiresAt": expires_at.isoformat()}


_FEEDBACK_SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        # Empty string, not null — Gemini's structured-output schema here
        # is plain JSON Schema without a nullable/union type, so "no growth
        # area to mention" is represented the same way _generate_feedback_
        # summary's own caller checks any other optional string field: a
        # falsy value, not a missing/null one.
        "growthArea": {"type": "string"},
    },
    "required": ["summary", "growthArea"],
    "additionalProperties": False,
}

# Turns a leader's 5 category ratings (1-10, never shown to them as
# numbers — see FEEDBACK_CATEGORY_LABELS) into an encouraging natural-
# language summary instead. Same genai.Client()-reads-the-env-var-itself,
# never-let-a-Gemini-hiccup-break-the-caller pattern as
# _generate_quest_recommendations — a summary/growthArea pair always comes
# back, even if that pair is the generic fallback below.
def _generate_feedback_summary(answers: dict, extra_thoughts: str | None) -> dict:
    category_lines = "\n".join(
        f"- {FEEDBACK_CATEGORY_LABELS[key]}: {value}/10" for key, value in answers.items()
    )
    prompt = (
        "You will receive an overall score and individual category scores internally.\n\n"
        "DO NOT display any numeric ratings, percentages, fractions, or letter grades to the "
        "user. Instead, generate a concise, encouraging summary that reflects the ratings using "
        "natural language.\n\n"
        "Rules:\n"
        "1. Never reveal the underlying scores.\n"
        "2. Mention each category exactly once.\n"
        "3. Translate scores into descriptive language using roughly this mapping — 10: "
        "outstanding, exceptional, consistently demonstrated, went above and beyond. 8-9: strong, "
        "actively, consistently, meaningful, reliable. 6-7: solid, generally, often, good. 4-5: "
        "occasional, developing, showed moments of. 1-3: limited, could benefit from greater, "
        "opportunities to improve.\n"
        "4. Keep the tone positive and constructive.\n"
        "5. Focus on behaviors rather than judgments.\n"
        "6. Keep the summary between 60 and 120 words.\n"
        "7. If every category is 8 or above, write an overall highly positive summary and leave "
        "growthArea as an empty string.\n"
        "8. If some categories are lower, acknowledge strengths first, then set growthArea to one "
        "sentence describing the biggest improvement area without mentioning scores. Otherwise "
        "leave growthArea as an empty string.\n\n"
        f"Categories and their scores (internal only, never repeat these numbers back):\n{category_lines}\n\n"
        + (f'The organization also left this note about them: "{extra_thoughts}"\n\n' if extra_thoughts else "\n")
        + "Do not include any numbers, grades, rankings, or references to a hidden scoring system "
        "anywhere in your response."
    )

    fallback = {
        "summary": (
            "Thanks for stepping up on this quest — the organization took the time to share "
            "feedback on how it went, and it's ready for you to read."
        ),
        "growthArea": "",
    }
    try:
        client = genai.Client()
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                max_output_tokens=1024,
                response_mime_type="application/json",
                response_json_schema=_FEEDBACK_SUMMARY_SCHEMA,
            ),
        )
        if not response.text:
            return fallback
        parsed = json.loads(response.text)
        summary = parsed.get("summary")
        if not summary or not isinstance(summary, str):
            return fallback
        growth_area = parsed.get("growthArea")
        return {"summary": summary, "growthArea": growth_area if isinstance(growth_area, str) else ""}
    except Exception:
        return fallback


# Callable from the org dashboard's pending feedback requests queue (own
# quests only, or admin for any) — answering one specific leader's request
# with the fixed 5-question form plus an optional note. Always persists the
# real answers/score once submitted, even if the leader's monthly cap has
# already been used up elsewhere (see the cap-recheck below) — only the
# bonus points are conditional, not the feedback itself.
@https_fn.on_call()
def submit_feedback_request_response(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "organization", "admin")

    quest_id = req.data.get("questId")
    uid = req.data.get("uid")
    answers = req.data.get("answers")
    extra_thoughts = req.data.get("extraThoughts")
    if not quest_id or not uid:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "questId and uid are required.")

    if not isinstance(answers, dict) or set(answers) != set(FEEDBACK_QUESTIONS):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"answers must include exactly these ratings: {', '.join(FEEDBACK_QUESTIONS)}.",
        )
    for value in answers.values():
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 10:
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                "Every answer must be an integer between 1 and 10.",
            )
    if extra_thoughts is not None:
        if not isinstance(extra_thoughts, str):
            raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "extraThoughts must be a string.")
        if len(extra_thoughts) > EXTRA_THOUGHTS_MAX_LENGTH:
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                f"extraThoughts must be at most {EXTRA_THOUGHTS_MAX_LENGTH} characters.",
            )
        extra_thoughts = extra_thoughts.strip() or None

    db = firestore.client()
    quest = _get_quest_or_404(db, quest_id)
    _require_owning_org_or_admin(req, quest, "respond to feedback for")

    request_ref = _feedback_request_ref(db, quest_id, uid)
    request_snap = request_ref.get()
    if not request_snap.exists:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, "No feedback request found.")
    request = request_snap.to_dict()
    if request.get("status") != "pending":
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "This request has already been answered.",
        )
    now = datetime.now(timezone.utc)
    if now >= _to_utc(request["expiresAt"]):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "This request has expired.",
        )

    score = round(sum(answers.values()) / len(answers), 1)
    # Re-check the cap here, not just in request_quest_feedback — several
    # orgs' requests can be pending at once (nothing caps pending count,
    # only completed count), so this is the only point that can see the
    # leader's true completed-this-month total including this submission.
    # The request still completes with its real score either way; only the
    # bonus is withheld once the cap's already been used up elsewhere.
    under_cap = _completed_feedback_requests_this_month(db, uid) < FEEDBACK_REQUEST_MONTHLY_CAP
    points = FEEDBACK_BONUS_POINTS if score >= FEEDBACK_SCORE_THRESHOLD and under_cap else 0

    # answers/score still get stored (org's own record, and what the bonus
    # above is computed from) — summary/growthArea are what the leader
    # actually sees; see _generate_feedback_summary's own note on why the
    # raw numbers never reach that side.
    generated = _generate_feedback_summary(answers, extra_thoughts)

    completion_fields = {
        "status": "completed",
        "answers": answers,
        "extraThoughts": extra_thoughts,
        "score": score,
        "summary": generated["summary"],
        "growthArea": generated["growthArea"],
        "pointsAwarded": points,
        "completedAt": firestore.SERVER_TIMESTAMP,
    }
    batch = db.batch()
    batch.update(request_ref, completion_fields)
    batch.update(_journal_ref(db, uid, quest_id), {
        "requestStatus": "completed",
        "answers": answers,
        "extraThoughts": extra_thoughts,
        "score": score,
        "summary": generated["summary"],
        "growthArea": generated["growthArea"],
        "pointsAwarded": points,
        "completedAt": firestore.SERVER_TIMESTAMP,
        "read": False,
    })
    batch.commit()
    _award_points(db, uid, points)
    # Home-screen dismissible notice (see NotificationBanner.jsx) — same
    # mechanism already used for quest_rescheduled/quest_cancelled, rather
    # than a separate one-off popup. `read` above is unrelated: it still
    # gates the Journal page's own unread badge on this entry, independent
    # of whether this Home notice has been seen/dismissed.
    _notify_user(
        db, uid, kind="feedback_received", quest_id=quest_id, quest_title=quest.get("title"),
        extra={"pointsAwarded": points},
    )

    return {"success": True, "score": score, "pointsAwarded": points}


# AI-ranked ordering of organization quests on the Quests page — not a
# client-callable itself; the frontend never asks for a fresh ranking, it
# only ever reads whatever's already on the user doc (recommendedQuestOrder,
# below). Only ranks organization quests: side quests are generic/tier-
# based, not location- or org-specific, so they keep the plain client-side
# tag-overlap sort (see relevanceScore in Quests.jsx) instead.
#
# What this used to be based on: a "user" manually curated an `interests`
# list from Settings, and every single save re-ran this whole Gemini call
# (see update_interests, now removed, and update_accommodation_needs, which
# still does the same for the accessibility/location fields it owns).
# That's gone for interests specifically — there's no Settings control for
# it anymore, so it can't drift out of sync with actual behavior the way a
# stated-once, rarely-revisited preference can, and it can't be used to
# force a fresh (costly) Gemini call on demand either. `interests` itself
# still exists as a field (set once at onboarding — see submit_onboarding)
# and still rides along in the prompt below as a cold-start hint for a
# brand-new "user" with no attendance history yet, but it's no longer the
# headline signal or a refresh trigger.
#
# What actually triggers a refresh now: real quest attendance. Every
# RECOMMENDATION_REFRESH_INTERVAL-th quest a "user" completes (see
# _record_quest_attended, called from check_in_to_event and
# approve_photo_submission — the only two places a NEW attendance record
# gets created) re-runs this. Recommendations respond to what someone
# actually did, not a preference they set once and maybe never revisit, and
# a real LLM call happens for at most 1-in-N attended quests instead of on
# every settings save — the actual point of counting attendance at all,
# not just a side benefit.
RECOMMENDATION_REFRESH_INTERVAL = 5


# attendedTagCounts is a plain {tag: count} map, not a dotted-field-path
# Increment — quest tags are free text (CreateQuestForm never restricts
# them to a fixed vocabulary), so a tag containing a literal "." would
# otherwise be misread as a nested-map path by a dotted update() key.
# Reading, mutating, and rewriting the whole map inside this transaction
# sidesteps that entirely: every key here is a plain dict key, never parsed
# as a path.
def _apply_quest_attended(transaction, user_ref, tags):
    snap = user_ref.get(transaction=transaction)
    data = snap.to_dict() if snap.exists else {}
    count = data.get("questsAttended", 0) + 1
    tag_counts = dict(data.get("attendedTagCounts") or {})
    for tag in tags:
        tag_counts[tag] = tag_counts.get(tag, 0) + 1
    transaction.update(user_ref, {"questsAttended": count, "attendedTagCounts": tag_counts})
    return count


# Called from check_in_to_event/approve_photo_submission's own attendance-
# doc-creation branches only — i.e. exactly once per genuinely NEW
# attendance record, never on a repeat check-in or the org-quest +5 photo
# bonus that follows a check-in already counted (see both call sites' own
# notes on why attendance-doc existence, not points awarded, is what "new"
# means here). Same atomic read-increment-write shape as _apply_points/
# _award_points above, kept separate from that one since points get
# awarded from places (the feedback-request bonus, add_submission_to_gallery)
# that have nothing to do with completing a quest and shouldn't bump this.
#
# `tags` (the just-attended quest's own tags) feeds attendedTagCounts — a
# running, frequency-weighted tally of what this person has actually done,
# read both by _generate_quest_recommendations below (the AI call, gated to
# every RECOMMENDATION_REFRESH_INTERVAL-th quest) and by the frontend's own
# relevanceScore fallback (every quest, no gate at all — see
# mobile/Quests.jsx) for whatever an AI refresh hasn't ranked yet.
def _record_quest_attended(db, uid: str, tags: list) -> None:
    count = firestore.transactional(_apply_quest_attended)(
        db.transaction(), db.collection("users").document(uid), tags,
    )
    if count % RECOMMENDATION_REFRESH_INTERVAL == 0:
        _refresh_quest_recommendations(db, uid)


AI_RECOMMENDATION_CANDIDATE_LIMIT = 40  # keeps the prompt bounded regardless of catalog size

_QUEST_RECOMMENDATION_SCHEMA = {
    "type": "object",
    "properties": {
        "recommendations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "questId": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["questId", "reason"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["recommendations"],
    "additionalProperties": False,
}


def _generate_quest_recommendations(db, uid: str) -> None:
    user_snap = db.collection("users").document(uid).get()
    if not user_snap.exists:
        return
    user = user_snap.to_dict()

    # Group upcoming, not-yet-joined org quests by seriesId, so a weekly
    # recurring series is offered to Gemini once (its soonest occurrence)
    # rather than as N near-duplicate rows — the eventual rank is expanded
    # back across every occurrence below.
    now = datetime.now(timezone.utc)
    series = {}  # seriesId -> {"quest": soonest occurrence dict, "occurrences": [{"id","eventDate"}, ...]}
    for doc in db.collection("quests").where("isDefault", "==", False).stream():
        quest = doc.to_dict()
        event_date = quest.get("eventDate")
        if event_date is None or _to_utc(event_date) < now or uid in (quest.get("rsvpd") or []):
            continue
        quest["id"] = doc.id
        series_id = quest.get("seriesId") or doc.id
        entry = series.setdefault(series_id, {"quest": quest, "occurrences": []})
        entry["occurrences"].append({"id": doc.id, "eventDate": event_date})
        if _to_utc(event_date) < _to_utc(entry["quest"]["eventDate"]):
            entry["quest"] = quest

    ranked_series_ids = sorted(series, key=lambda sid: _to_utc(series[sid]["quest"]["eventDate"]))
    ranked_series_ids = ranked_series_ids[:AI_RECOMMENDATION_CANDIDATE_LIMIT]
    if not ranked_series_ids:
        return

    candidates = [series[sid]["quest"] for sid in ranked_series_ids]
    series_id_by_candidate_id = dict(zip((c["id"] for c in candidates), ranked_series_ids))

    # "Volunteer activity" signal — tags from quests this user has actually
    # completed before, most-attended-first. The primary signal now (see the
    # module note above RECOMMENDATION_REFRESH_INTERVAL): real behavior, not
    # a stated-once preference. Reads the running attendedTagCounts tally
    # (see _record_quest_attended) rather than re-scanning the whole
    # attendance collection on every refresh — same data, far fewer reads.
    attended_tag_counts = user.get("attendedTagCounts") or {}
    attended_tags = sorted(attended_tag_counts, key=attended_tag_counts.get, reverse=True)

    candidate_lines = "\n".join(
        f'- questId "{c["id"]}": "{c.get("title")}" ({c.get("description")}) — '
        f'tags: {c.get("tags") or []}, location: {c.get("location")}, '
        f'accessibility accommodations: {c.get("accommodationTags") or []}'
        for c in candidates
    )
    prompt = (
        "Rank the following volunteer quests for this specific person, most relevant first, based "
        "on their profile below. Weigh the tags from quests they've actually completed before most "
        "heavily — that's real behavior, not a stated preference. Their onboarding interests are a "
        "fallback for when they have little or no completed-quest history yet, not a primary signal. "
        "After that, weigh their experience level, motivation, group preference, and leadership goal, "
        "and how well each quest's own tags/description align with all of the above.\n\n"
        f"Tags from quests they've completed before, most-attended first: {attended_tags or 'none yet'}\n"
        f"Interests stated at onboarding (fallback only): {user.get('interests') or []}\n"
        f"Lives near: {user.get('location') or 'unspecified'}\n"
        f"Experience level: {user.get('experienceLevel') or 'unspecified'}\n"
        f"Motivation: {user.get('motivation') or 'unspecified'}\n"
        f"Group preference: {user.get('groupPreference') or 'unspecified'}\n"
        f"Leadership goal: {user.get('leaderGoal') or 'unspecified'}\n"
        f"Accessibility needs: {user.get('accommodationNeeds') or []}\n\n"
        f"Quests to rank:\n{candidate_lines}\n\n"
        "Return every questId listed above exactly once, ordered most-to-least relevant, each with "
        "a brief (one sentence) reason."
    )

    # genai.Client() reads GEMINI_API_KEY from the environment on its own —
    # created here, not at module level, so a missing/misconfigured secret
    # only breaks this one function's cold start, not every function in
    # this file (see the ORG_QUEST_BASE_POINTS module note for the same
    # reasoning applied to Firestore access elsewhere).
    client = genai.Client()
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=genai_types.GenerateContentConfig(
            max_output_tokens=4096,
            response_mime_type="application/json",
            response_json_schema=_QUEST_RECOMMENDATION_SCHEMA,
        ),
    )
    text = response.text
    if not text:
        return
    picks = json.loads(text).get("recommendations", [])

    # A questId Gemini returns that isn't actually one we offered (or a
    # repeat of a series already placed) is silently dropped rather than
    # trusted — same "unrecognized entries are skipped" precedent as
    # submit_feedback_request_response above.
    order = []
    reasons = {}
    placed_series = set()
    for pick in picks:
        if not isinstance(pick, dict):
            continue
        series_id = series_id_by_candidate_id.get(pick.get("questId"))
        if series_id is None or series_id in placed_series:
            continue
        placed_series.add(series_id)
        reason = pick.get("reason") or ""
        occurrences = sorted(series[series_id]["occurrences"], key=lambda o: _to_utc(o["eventDate"]))
        for occurrence in occurrences:
            order.append(occurrence["id"])
            reasons[occurrence["id"]] = reason

    if not order:
        return

    db.collection("users").document(uid).update({
        "recommendedQuestOrder": order,
        "recommendedQuestReasons": reasons,
        "recommendedAt": firestore.SERVER_TIMESTAMP,
    })


def _refresh_quest_recommendations(db, uid: str) -> None:
    # Never raises — a Gemini hiccup (or any other failure while generating
    # recommendations) must never fail the onboarding/interests/
    # accommodation-needs update that triggered it. Whatever ranking
    # already existed, if any, is simply left as-is.
    try:
        _generate_quest_recommendations(db, uid)
    except Exception:
        pass


# Callable from the Journal page when a user opens a specific entry — clears
# that entry's contribution to the BottomNav badge count.
@https_fn.on_call()
def mark_feedback_read(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)
    quest_id = req.data.get("questId")
    if not quest_id:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "questId is required.")
    firestore.client().collection("users").document(req.auth.uid).collection("journal").document(quest_id).update({
        "read": True,
    })
    return {"success": True}


# A one-off popup notice at users/{uid}/notifications/{autoId} — distinct
# from users/{uid}/journal (a permanent record of feedback/reflections tied
# to a specific completed quest): a notification is transient and has no
# reason to persist once seen, so dismissing it (see dismiss_notification
# below) deletes the doc outright rather than flipping a `read` flag. Used
# for the two ways a quest can change out from under someone who's already
# RSVP'd (update_quest's reschedule, the delete_quest* family's
# cancellation) and, with quest_id/quest_title both omitted, for
# approve_organization's own "you're approved" notice — generic enough for
# any future notice that isn't about a specific quest at all. `uid` works
# for an organization's own uid exactly the same way it does a member's —
# this collection is keyed by uid alone, not scoped to the "user" role (see
# firestore.rules' identical `request.auth.uid == uid` check on it).
def _notify_user(db, uid: str, *, kind: str, quest_id: str = None, quest_title: str = None, extra: dict = None) -> None:
    doc = {
        "kind": kind,
        "questId": quest_id,
        "questTitle": quest_title,
        "createdAt": firestore.SERVER_TIMESTAMP,
    }
    if extra:
        doc.update(extra)
    db.collection("users").document(uid).collection("notifications").document().set(doc)


# Callable from the Home page's dismissible notice banner (mobile/Home.jsx)
# — the only way one of these is ever removed, matching the rest of the
# app's "every write goes through a Cloud Function" rule (see
# firestore.rules' module note).
@https_fn.on_call()
def dismiss_notification(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)
    notification_id = req.data.get("notificationId")
    if not notification_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "notificationId is required.",
        )
    firestore.client().collection("users").document(req.auth.uid).collection(
        "notifications",
    ).document(notification_id).delete()
    return {"success": True}


REFLECTION_MAX_LENGTH = 4000


# Callable from the Journal page's reflection textarea. Requires the
# journal doc to already exist — it's created at check-in time (see
# check_in_to_event), so this is really just "have you checked into this
# organization quest," not anything to do with feedback (unlike before this
# journal/feedback split, a reflection no longer depends on feedback ever
# arriving). Purely private (see firestore.rules: only the owner or an
# admin can ever read it); doesn't affect rank.
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

    ref = firestore.client().collection("users").document(req.auth.uid).collection("journal").document(quest_id)
    if not ref.get().exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND,
            "No journal entry found for this quest yet.",
        )
    ref.update({"reflectionBody": body.strip(), "reflectionUpdatedAt": firestore.SERVER_TIMESTAMP})
    return {"success": True}


# Callable from the Journal page's per-entry "Change background picture"
# menu item — a purely decorative field on the caller's own journal entry,
# same self-scoped-by-path shape as submit_quest_reflection above (no
# separate ownership check needed: the doc lives under
# users/{req.auth.uid}/journal, so there's nothing to check against).
# thumbnailUrl is usually a plain, already-resolved URL string (one of a
# small curated set the frontend offers, same "store the URL, not
# something to resolve later" choice organizations.logoUrl already made)
# — but can also be a raw Storage path when approve_photo_submission
# auto-fills it from an approved proof photo, resolved client-side the
# same way HeroCarousel.jsx/PendingPhotoReview.jsx already resolve org
# photos. null clears it back to the entry's default unwritten/blank look.
@https_fn.on_call()
def set_journal_thumbnail(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)

    quest_id = req.data.get("questId")
    thumbnail_url = req.data.get("thumbnailUrl")
    if not quest_id:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "questId is required.")
    if thumbnail_url is not None and not isinstance(thumbnail_url, str):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "thumbnailUrl must be a string or null.",
        )

    ref = firestore.client().collection("users").document(req.auth.uid).collection("journal").document(quest_id)
    if not ref.get().exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND,
            "No journal entry found for this quest yet.",
        )
    ref.update({"thumbnailUrl": thumbnail_url})
    return {"success": True}


# Organization hosting reflections -------------------------------------------
#
# The organization side of the same journal idea: once a quest occurrence
# has actually happened, the hosting org can privately write its own
# reflection on how the hosting went. Lives at
# organizations/{orgId}/hostReflections/{questId}, one doc per occurrence,
# mirroring users/{uid}/feedback/{questId}'s shape. Unlike a member's
# reflection there's no prior feedback doc to gate on — the gate here is
# just that the occurrence has already happened, using the same effective-
# end check _qr_expires_at uses for QR expiry (and the frontend's
# isUpcoming). Purely private (see firestore.rules: owner-or-admin read
# only); doesn't affect points or rank.

HOST_REFLECTION_MAX_LENGTH = 4000


def _host_reflection_ref(db, org_id: str, quest_id: str):
    return db.collection("organizations").document(org_id).collection("hostReflections").document(quest_id)


def _delete_org_host_reflections(db, org_id: str):
    for doc in db.collection("organizations").document(org_id).collection("hostReflections").stream():
        doc.reference.delete()


# Callable from the org dashboard journal's reflection textarea. Requires
# the occurrence to have already happened — an org reflects on hosting it
# actually did, not one still upcoming.
@https_fn.on_call()
def submit_host_reflection(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "organization", "admin")

    quest_id = req.data.get("questId")
    body = req.data.get("body")
    if not quest_id:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "questId is required.")
    if not isinstance(body, str) or len(body) > HOST_REFLECTION_MAX_LENGTH:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            f"body must be a string of at most {HOST_REFLECTION_MAX_LENGTH} characters.",
        )

    db = firestore.client()
    quest = _get_quest_or_404(db, quest_id)
    _require_owning_org_or_admin(req, quest, "reflect on")
    if not quest.get("orgId"):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "This quest has no organization to reflect as.",
        )

    expires_at = _qr_expires_at(quest["eventDate"], quest.get("eventEndTime"))
    if datetime.now(timezone.utc) < expires_at:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "You can only reflect on a quest once it's actually happened.",
        )

    _host_reflection_ref(db, quest["orgId"], quest_id).set({
        "questId": quest_id,
        "questTitle": quest.get("title"),
        "eventDate": quest.get("eventDate"),
        "reflectionBody": body.strip(),
        "reflectionUpdatedAt": firestore.SERVER_TIMESTAMP,
    }, merge=True)
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

    # One batched read for every attendee's name/email, not one
    # users/{uid}.get() per RSVP inside the loop below — a well-attended
    # quest was doing one serial round-trip per attendee just to list them.
    rsvpd_uids = quest.get("rsvpd", [])
    users_by_uid = {}
    if rsvpd_uids:
        refs = [db.collection("users").document(uid) for uid in rsvpd_uids]
        users_by_uid = {s.id: s.to_dict() for s in db.get_all(refs) if s.exists}

    attendees = []
    for uid in rsvpd_uids:
        user_data = users_by_uid.get(uid, {})
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

# Organization Trust Score (see AI_README.md) ---------------------------
#
# Distinct from the per-series reviewCount/avgRating above: a quest series
# is one specific recurring event, while an organization typically runs
# many series over time. _record_review rolls every review into BOTH
# rollups in the same transaction — the series' own rating (what a member
# sees deciding whether to attend that particular event) and the org's
# rating (the org's platform-wide reputation).
#
# The org's rollup itself (avgRating on organizations/{uid}) stays on the
# same 1-5 scale as every individual rating, the same way questSeries'
# avgRating does — that's what makes the incremental running-average math
# in _record_review correct. The underlying 0-100 Trust Score (see
# _trust_score) is derived from that average at read time, never stored —
# so there's only ever one source of truth to update per review — and it
# never leaves the server as a number. Members only ever see one of three
# tags (see _trust_status/list_organization_trust_tags): "new" (not enough
# reviews yet to judge), "trustworthy" (cleared TRUST_SCORE_TAG_THRESHOLD),
# or "under_review" (a warning — settled at or below
# TRUST_SCORE_FLAG_THRESHOLD, the same bar that gets an org flagged for
# admin). Anything in between those two thresholds is unremarkable enough
# to get no tag at all. Admin is the one place that still sees the real
# numbers regardless of tag (see admin_list_organizations).
TRUST_SCORE_MIN_REVIEWS = 3
TRUST_SCORE_MAX = 100
TRUST_SCORE_FLAG_THRESHOLD = 60  # "under_review" / admin-flagged once eligible AND at/below this
TRUST_SCORE_TAG_THRESHOLD = 80  # "trustworthy" once eligible AND at/above this


def _trust_score(avg_rating: float) -> int:
    return round((avg_rating / MAX_RATING) * TRUST_SCORE_MAX)


def _trust_status(review_count: int, avg_rating: float) -> str | None:
    if review_count < TRUST_SCORE_MIN_REVIEWS:
        return "new"
    score = _trust_score(avg_rating)
    if score >= TRUST_SCORE_TAG_THRESHOLD:
        return "trustworthy"
    if score <= TRUST_SCORE_FLAG_THRESHOLD:
        return "under_review"
    return None


def _record_review(transaction, series_ref, review_ref, org_ref, rating, body, uid, quest_id, event_date):
    series_snap = series_ref.get(transaction=transaction)
    org_snap = org_ref.get(transaction=transaction)
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

    org = org_snap.to_dict() or {}
    org_current_count = org.get("reviewCount", 0)
    org_current_avg = org.get("avgRating", 0)
    org_new_count = org_current_count + 1
    org_new_avg = ((org_current_avg * org_current_count) + rating) / org_new_count

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
    transaction.set(org_ref, {"reviewCount": org_new_count, "avgRating": org_new_avg}, merge=True)


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
# self-only shape as update_accommodation_needs. No targetUid, so there's
# nothing to escalate. Scoped to questId, not the whole series — a member who's
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
    review_dicts = [
        doc.to_dict()
        for doc in db.collection("questSeries").document(series_id).collection("reviews").stream()
    ]

    # One batched read for every reviewer's name, not one users/{uid}.get()
    # per review inside the loop below — a popular quest series with dozens
    # of reviews was doing dozens of serial round-trips just to label them.
    uids = {r["uid"] for r in review_dicts if r.get("uid")}
    users_by_uid = {}
    if uids:
        refs = [db.collection("users").document(uid) for uid in uids]
        users_by_uid = {s.id: s.to_dict() for s in db.get_all(refs) if s.exists}

    reviews = []
    for review in review_dicts:
        uid = review.get("uid")
        user_data = users_by_uid.get(uid, {})
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


# Callable from anywhere an organization's name is shown to a member (quest
# list, quest cards) — the public-facing half of the Trust Score feature.
# Open to any signed-in user, same reasoning as list_quest_reviews, but
# unlike that function this never exposes the underlying score, review
# count, or average at all — only which of the three tags applies (see
# _trust_status): "new", "trustworthy", "under_review", or null for an org
# that's eligible but landed in the unremarkable middle. Admins see the
# true numbers regardless — see admin_list_organizations.
@https_fn.on_call()
def list_organization_trust_tags(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)

    organizations = []
    for doc in firestore.client().collection("organizations").stream():
        org = doc.to_dict()
        organizations.append({
            "orgId": doc.id,
            "trustStatus": _trust_status(org.get("reviewCount", 0), org.get("avgRating", 0)),
        })
    return {"organizations": organizations}


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
_SIMPLE_PROFILE_FIELDS = (
    "logoUrl", "category", "missionStatement", "website", "contactEmail",
    # `phone` starts out copied from the org's original ORGREQ at approval
    # time (see approve_organization_request), but the org's profile edit
    # form shows it as an editable contact number, so it stays editable
    # afterward too. `reason` (also copied from that same ORGREQ) is
    # deliberately NOT here — it's the org's answer to "what do you hope to
    # get out of this?" from registration, meant only for an admin
    # reviewing that request (see approve_organization_request), not
    # something the org edits or that renders on their public profile (see
    # OrganizationProfile.jsx/MapQuestDetailBody.jsx's own note on this).
    "phone",
)

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

    # location/placeId/lat/lng replace the org's original signup address
    # (see submit_organization_request) with a fresh Places Autocomplete
    # selection — same "all four travel together" shape as
    # update_accommodation_needs's own location fields.
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

    firestore.client().collection("organizations").document(req.auth.uid).update(update)
    return {"success": True}


# Callable from the org's own profile page — adds one photo to its public
# "Community Photos" gallery. No moderation step (unlike quest proof
# photos): an org's own gallery is the same trust level as everything else
# it already controls on its profile (About section, quest descriptions),
# so this publishes immediately. organizations.photos stores storage paths,
# not resolved URLs — same pattern photoSubmissions already uses (see
# submit_quest_photo) — the frontend resolves each one to a download URL
# lazily via getDownloadURL, so there's nothing to keep in sync here if a
# bucket's URL-signing scheme ever changes.
@https_fn.on_call()
def add_organization_photo(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "organization")

    storage_path = req.data.get("storagePath")
    if not storage_path:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "storagePath is required.",
        )
    # Confined to this org's own folder — the same client-side upload path
    # convention (orgPhotos/{orgId}/...) is enforced here too, not just
    # trusted, so a caller can't register some other path (their own
    # unrelated file, or worse someone else's) into their gallery.
    expected_prefix = f"orgPhotos/{req.auth.uid}/"
    if not storage_path.startswith(expected_prefix):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "storagePath must be this organization's own upload.",
        )

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
            f"contentType must be one of {sorted(ALLOWED_PHOTO_CONTENT_TYPES)}.",
        )

    firestore.client().collection("organizations").document(req.auth.uid).update({
        "photos": firestore.ArrayUnion([storage_path]),
    })
    return {"success": True}


# Callable from the org's own profile page — removes one photo from its own
# gallery (never anyone else's; ownership is enforced the same way as
# add_organization_photo above). Deletes the actual Storage object too, not
# just the array entry, so a removed photo doesn't sit around orphaned.
@https_fn.on_call()
def remove_organization_photo(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "organization")

    storage_path = req.data.get("storagePath")
    if not storage_path:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "storagePath is required.",
        )
    expected_prefix = f"orgPhotos/{req.auth.uid}/"
    if not storage_path.startswith(expected_prefix):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "storagePath must be this organization's own photo.",
        )

    firestore.client().collection("organizations").document(req.auth.uid).update({
        "photos": firestore.ArrayRemove([storage_path]),
    })
    admin_storage.bucket().blob(storage_path).delete()
    return {"success": True}


# Callable from Profile — lets an already-onboarded "user" change their
# accommodation needs and/or location after the fact (onboarding only ever
# sets them once). An empty accommodationNeeds list is valid (it means "no
# needs anymore"), and location/placeId/lat/lng are only touched when
# actually present in the request — see update_organization_profile above
# for the same "present key = change it" shape. Both feed
# _has_enough_accessible_org_quests, so keeping them current matters for the
# side-quest-limit relaxation, not just display. Interests has no equivalent
# callable of its own anymore — see the module note above
# _generate_quest_recommendations for why recommendations no longer change
# in reaction to a settings edit at all.
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

    db = firestore.client()
    db.collection("users").document(req.auth.uid).update(update)
    _refresh_quest_recommendations(db, req.auth.uid)
    return {"success": True}


# Callable from Profile's "Edit Profile" — a member's own display name,
# profile picture, and chosen duck avatar fallback. Email/password are
# Firebase Auth's own concern, not Firestore, so the frontend calls
# updateEmail/updatePassword directly against the client SDK instead of
# going through here (see Profile.jsx) — this is only for the fields that
# actually live on users/{uid}. photoURL is a resolved download URL, not a
# storage path — same "store the plain URL, not something to resolve
# later" choice organizations.logoUrl already made, for the same reason
# (fewer places need to know how to resolve a path). duckSkin only ever
# matters once photoURL is unset (see UserAvatar.jsx) — whitelisted
# against DUCK_SKINS above rather than accepting any string.
@https_fn.on_call()
def update_user_profile(req: https_fn.CallableRequest) -> dict:
    _require_role(req, "user")

    update = {}
    if "name" in req.data:
        name = req.data.get("name")
        if not isinstance(name, str) or not name.strip():
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                "name is required.",
            )
        update["name"] = name.strip()
    if "photoURL" in req.data:
        photo_url = req.data.get("photoURL")
        if photo_url is not None and not isinstance(photo_url, str):
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                "photoURL must be a string or null.",
            )
        update["photoURL"] = photo_url
    if "duckSkin" in req.data:
        duck_skin = req.data.get("duckSkin")
        if duck_skin not in DUCK_SKINS:
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                f"duckSkin must be one of {sorted(DUCK_SKINS)}.",
            )
        update["duckSkin"] = duck_skin

    if not update:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "Provide a name, photoURL, and/or duckSkin to update.",
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


# Called by Badges.jsx right after showing a "New" ribbon on a
# just-earned badge, so it doesn't show as new again on a later visit or
# a different device — localStorage alone (see badges.js) only covers
# "this browser," this is the cross-device source of truth. Self-only,
# arrayUnion so concurrent calls (or a retry) can't drop an id.
@https_fn.on_call()
def mark_badges_seen(req: https_fn.CallableRequest) -> dict:
    _require_auth(req)

    badge_ids = req.data.get("badgeIds")
    if not isinstance(badge_ids, list) or not badge_ids:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "badgeIds must be a non-empty list.",
        )

    firestore.client().collection("users").document(req.auth.uid).update({
        "seenBadgeIds": firestore.ArrayUnion(badge_ids),
    })
    return {"success": True}


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
        _delete_org_host_reflections(db, uid)
        db.collection("organizations").document(uid).delete()
    else:
        for quest_doc in db.collection("quests").where("rsvpd", "array_contains", uid).stream():
            quest_doc.reference.update({"rsvpd": firestore.ArrayRemove([uid])})
            _attendance_ref(db, quest_doc.id, uid).delete()
        # A pending feedbackRequests doc left behind here would let an org
        # later call submit_feedback_request_response against a uid whose
        # users/{uid} doc no longer exists — _award_points' transaction.
        # update() throws on a nonexistent doc, which would surface as a
        # confusing failure for the org, for reasons entirely unrelated to
        # anything they did. Deleting both collections here, not just the
        # journal one, is what actually prevents that.
        for doc in db.collection("users").document(uid).collection("journal").stream():
            doc.reference.delete()
        for doc in db.collection("feedbackRequests").where("uid", "==", uid).stream():
            doc.reference.delete()

    # Safe unconditionally — Firestore .delete() on a doc that doesn't exist
    # (e.g. no ORGREQ was ever filed, or the account is an admin with no
    # users/{uid} doc per complete_signup) is a no-op, not an error.
    db.collection("ORGREQ").document(uid).delete()
    db.collection("users").document(uid).delete()
    auth.delete_user(uid)

    return {"success": True}
