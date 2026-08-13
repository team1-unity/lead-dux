// Wrappers around the Cloud Functions defined in functions/main.py.
// httpsCallable(functions, name) doesn't call anything itself — it just
// returns a function you call with the request payload, similar to how
// axios.post(url) returns a promise once you actually invoke it. Firebase
// automatically attaches the caller's ID token to the request, which is
// what req.auth is reading on the Python side.

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebaseapp.jsx';
import { invalidateCachedCollection } from './collectionCache.js';

// Called once, right after Firebase Auth account creation — the one signup
// path for both accountTypes ('individual', the default, or 'organization').
// No admin gate — see functions/main.py for why this is safe to expose (the
// admin-allowlist check happens server-side regardless of what the client
// sends).
export async function callCompleteSignup({ name, accountType }) {
  const fn = httpsCallable(functions, 'complete_signup');
  const result = await fn({ name, accountType });
  return result.data;
}

// Called once from the onboarding (interests) form. No targetUid — this
// only ever writes the caller's own doc, so there's nothing to escalate.
export async function callSubmitOnboarding({
  name,
  age,
  location,
  placeId,
  lat,
  lng,
  interests,
  accommodationNeeds,
  experienceLevel,
  experienceLevelOther,
  timeAvailability,
  timeAvailabilityOther,
  groupPreference,
  groupPreferenceOther,
  motivation,
  motivationOther,
  leaderGoal,
}) {
  const fn = httpsCallable(functions, 'submit_onboarding');
  const result = await fn({
    name,
    age,
    location,
    placeId,
    lat,
    lng,
    interests,
    accommodationNeeds,
    experienceLevel,
    experienceLevelOther,
    timeAvailability,
    timeAvailabilityOther,
    groupPreference,
    groupPreferenceOther,
    motivation,
    motivationOther,
    leaderGoal,
  });
  return result.data;
}

// admin: the flexible, dangerous path — the Cloud Function itself rejects
// this with PERMISSION_DENIED unless the caller's own token already has
// role "admin", regardless of what targetUid/role is passed here.
export async function callSetUserRole(targetUid, role) {
  const fn = httpsCallable(functions, 'set_user_role');
  const result = await fn({ targetUid, role });
  return result.data;
}

// admin: approves a pending ORGREQ, copying it into organizations/{uid} and
// flipping the claim from pendingorg to organization. Admin-gated.
export async function callApproveOrganization(targetUid) {
  const fn = httpsCallable(functions, 'approve_organization');
  const result = await fn({ targetUid });
  return result.data;
}

// admin: lists all accounts (uid/email/role) for the admin dashboard's user
// list. Admin-gated — the client SDK has no way to enumerate users itself.
export async function callAdminListUsers() {
  const fn = httpsCallable(functions, 'admin_list_users');
  const result = await fn();
  return result.data.users;
}

// admin: lists all organization profiles, for the admin dashboard's
// organizations list.
export async function callAdminListOrganizations() {
  const fn = httpsCallable(functions, 'admin_list_organizations');
  const result = await fn();
  return result.data.organizations;
}

// admin: deletes an organization's profile and quests, and drops that
// account back to role "user".
export async function callDeleteOrganization(targetUid) {
  const fn = httpsCallable(functions, 'delete_organization');
  const result = await fn({ targetUid });
  return result.data;
}

// Called once a first-time leader or organization dismisses (or finishes)
// WelcomeTour.jsx's one-time feature walkthrough — never shows again.
export async function callMarkIntroSeen() {
  const fn = httpsCallable(functions, 'mark_intro_seen');
  const result = await fn();
  return result.data;
}

// The org-details form's submit, for an account currently onboarding_org
// (the state a brand-new org signup reaches directly). Creates the ORGREQ
// and moves the caller to pending_org.
export async function callSubmitOrganizationRequest({ name, phone, location, placeId, reason }) {
  const fn = httpsCallable(functions, 'submit_organization_request');
  const result = await fn({ name, phone, location, placeId, reason });
  return result.data;
}

// organization: creates a standalone quest owned by the caller's
// organization. eventDate/eventEndTime are ISO datetime strings (see
// EventDateFields) — eventEndTime is optional; the Cloud Function defaults
// the QR expiry to a few hours past eventDate when it's omitted. capacity
// is optional (unlimited if omitted). See callCreateRecurringQuest for
// creating a whole series of dates in one call.
export async function callCreateQuest({
  title, description, tags, eventDate, eventEndTime, timezone, location, placeId, lat, lng, capacity,
  accommodationTags, accommodationDetails,
}) {
  const fn = httpsCallable(functions, 'create_quest');
  const result = await fn({
    title, description, tags, eventDate, eventEndTime, timezone, location, placeId, lat, lng, capacity,
    accommodationTags, accommodationDetails,
  });
  invalidateCachedCollection('quests');
  return result.data;
}

// organization/admin: edits ONE existing quest occurrence (not a whole
// recurring series' pattern — see update_quest's own module note). Every
// field is optional — omit anything unchanged and only what's actually
// passed here gets validated/written server-side; a field left `undefined`
// is dropped entirely during serialization, which is how the Cloud
// Function tells "not touching this" apart from "clearing it back to
// blank" (an explicit `''`/`null`). Changing eventDate clears this quest's
// RSVPs and notifies whoever was on it — see NotificationBanner.jsx.
export async function callUpdateQuest({
  questId, title, description, tags, location, placeId, lat, lng, capacity,
  accommodationTags, accommodationDetails, eventDate, eventEndTime, timezone, tier,
}) {
  const fn = httpsCallable(functions, 'update_quest');
  const result = await fn({
    questId, title, description, tags, location, placeId, lat, lng, capacity,
    accommodationTags, accommodationDetails, eventDate, eventEndTime, timezone, tier,
  });
  invalidateCachedCollection('quests');
  return result.data;
}

// organization (own quests) or admin (any quest): adds one photo to a whole
// quest series' cover-photo gallery (see add_quest_series_cover_photo) —
// shared by every occurrence in the series, not just the one currently
// being viewed/edited. No cap on how many an org can add.
export async function callAddQuestSeriesCoverPhoto({ seriesId, coverPhotoUrl }) {
  const fn = httpsCallable(functions, 'add_quest_series_cover_photo');
  const result = await fn({ seriesId, coverPhotoUrl });
  invalidateCachedCollection('questSeries');
  return result.data;
}

// organization (own quests) or admin (any quest): removes one photo from a
// quest series' cover-photo gallery (see remove_quest_series_cover_photo).
export async function callRemoveQuestSeriesCoverPhoto({ seriesId, coverPhotoUrl }) {
  const fn = httpsCallable(functions, 'remove_quest_series_cover_photo');
  const result = await fn({ seriesId, coverPhotoUrl });
  invalidateCachedCollection('questSeries');
  return result.data;
}

// organization: creates a whole recurring series in one call — every
// occurrence up to (and including) `until`, spaced by `frequency`
// ('daily' | 'weekly' | 'monthly'). Returns { seriesId, questIds }. `tier`
// only matters when an admin calls this to create a recurring default
// (side/neighborhood) quest — see callCreateDefaultQuest.
export async function callCreateRecurringQuest({
  title,
  description,
  tags,
  eventDate,
  eventEndTime,
  timezone,
  location,
  placeId,
  lat,
  lng,
  capacity,
  frequency,
  until,
  tier,
  accommodationTags,
  accommodationDetails,
}) {
  const fn = httpsCallable(functions, 'create_recurring_quest');
  const result = await fn({
    title,
    description,
    tags,
    eventDate,
    eventEndTime,
    timezone,
    location,
    placeId,
    lat,
    lng,
    capacity,
    frequency,
    until,
    tier,
    accommodationTags,
    accommodationDetails,
  });
  invalidateCachedCollection('quests');
  invalidateCachedCollection('questSeries');
  return result.data;
}

// organization (own quest) or admin (own default quest): turns an existing
// standalone quest into the first occurrence of a recurring series,
// generating the remaining dates. Rejects if it's already part of a series.
export async function callMakeQuestRecurring({ questId, frequency, until }) {
  const fn = httpsCallable(functions, 'make_quest_recurring');
  const result = await fn({ questId, frequency, until });
  invalidateCachedCollection('quests');
  invalidateCachedCollection('questSeries');
  return result.data;
}

// organization (own series) or admin (own default series): changes an
// *existing* series' frequency/until, adding or removing future
// occurrences to match — see update_recurring_series in functions/main.py
// for exactly what that diff does and why it refuses rather than silently
// dropping RSVPs. Past occurrences and the returned counts are the only
// thing this ever reports back; the actual added/removed docs aren't
// individually listed since nothing here needs to react to which
// particular ids changed, only that the series as a whole now matches.
export async function callUpdateRecurringSeries({ seriesId, frequency, until }) {
  const fn = httpsCallable(functions, 'update_recurring_series');
  const result = await fn({ seriesId, frequency, until });
  invalidateCachedCollection('quests');
  invalidateCachedCollection('questSeries');
  return result.data;
}

// admin: creates a quest with no owning organization, shown to everyone.
// `tier` (iron/bronze/silver/gold/diamond) is required — it's what the
// quest's check-in base points come from (see TIER_BASE_POINTS,
// functions/main.py).
export async function callCreateDefaultQuest({ title, description, tags, eventDate, eventEndTime, timezone, location, capacity, tier }) {
  const fn = httpsCallable(functions, 'create_default_quest');
  const result = await fn({ title, description, tags, eventDate, eventEndTime, timezone, location, capacity, tier });
  invalidateCachedCollection('quests');
  return result.data;
}

// organization (own quests) or admin (any quest): deletes just this one
// occurrence. See callDeleteQuestSeries to remove a whole recurring series.
export async function callDeleteQuest(questId) {
  const fn = httpsCallable(functions, 'delete_quest');
  const result = await fn({ questId });
  invalidateCachedCollection('quests');
  return result.data;
}

// organization (own quests) or admin (any quest): deletes every occurrence
// sharing this quest's series. questId can be any occurrence in the
// series. Pass keepQuestId to preserve one specific occurrence instead of
// deleting the whole series — that survivor becomes a plain standalone
// quest again (recurrence cleared) rather than being deleted too.
export async function callDeleteQuestSeries(questId, keepQuestId) {
  const fn = httpsCallable(functions, 'delete_quest_series');
  const result = await fn({ questId, keepQuestId });
  invalidateCachedCollection('quests');
  invalidateCachedCollection('questSeries');
  return result.data;
}

// user: adds the caller's uid to a quest's rsvpd list.
export async function callRsvpToQuest(questId) {
  const fn = httpsCallable(functions, 'rsvp_to_quest');
  const result = await fn({ questId });
  invalidateCachedCollection('quests');
  return result.data;
}

// user: removes the caller's uid from a quest's rsvpd list.
export async function callCancelRsvp(questId) {
  const fn = httpsCallable(functions, 'cancel_rsvp');
  const result = await fn({ questId });
  invalidateCachedCollection('quests');
  return result.data;
}

// user: self-only. Returns { unlockedTiers, activeSideQuestIds, limit,
// atLimit } — which side quest tiers the caller's rank has unlocked, which
// of their side quests are still RSVP'd-but-not-checked-in (occupying one
// of `limit` concurrent slots), and whether they're at that limit right
// now. rsvp_to_quest enforces the same rules server-side; this just lets
// the quest list gray out and explain locked/at-limit side quests ahead of
// a failed RSVP attempt.
export async function callGetSideQuestStatus() {
  const fn = httpsCallable(functions, 'get_side_quest_status');
  const result = await fn({});
  return result.data;
}

// organization (own quest) or admin (any quest): mints this quest's QR
// code if it doesn't have one yet, or re-renders the existing one — never
// rotates an existing token (see callRefreshEventQrCode for that).
export async function callGenerateEventQrCode(questId) {
  const fn = httpsCallable(functions, 'generate_event_qr_code');
  const result = await fn({ questId });
  return result.data;
}

// organization (own quest) or admin (any quest): re-renders the quest's
// current QR code image without minting or rotating anything.
export async function callGetEventQrCode(questId) {
  const fn = httpsCallable(functions, 'get_event_qr_code');
  const result = await fn({ questId });
  return result.data;
}

// organization (own quest) or admin (any quest): rotates the quest's QR
// token, invalidating the previous one (any attendance already recorded
// against the old token is untouched).
export async function callRefreshEventQrCode(questId) {
  const fn = httpsCallable(functions, 'refresh_event_qr_code');
  const result = await fn({ questId });
  return result.data;
}

// user: validates a scanned event QR's {questId, token} payload and checks
// the CALLER themself in (self-service — this is the whole point of the
// event-QR redesign, as opposed to an org scanning each attendee).
export async function callCheckInToEvent({ questId, token }) {
  const fn = httpsCallable(functions, 'check_in_to_event');
  const result = await fn({ questId, token });
  return result.data;
}

// user: submits a photo already uploaded to Storage (see
// QuestPhotoSubmission.jsx) as proof of a completed quest. storagePath must
// be under photoSubmissions/{questId}_{uid}/ — see storage.rules. Rejects
// with FAILED_PRECONDITION if the caller hasn't accepted (side quest) or
// checked in (organization quest), ALREADY_EXISTS if a pending/approved
// submission already exists (resubmission is only allowed after a
// rejection). reflection is required for side quests only — the Cloud
// Function ignores/never stores it for organization quests.
export async function callSubmitQuestPhoto({ questId, storagePath, contentType, reflection }) {
  const fn = httpsCallable(functions, 'submit_quest_photo');
  const result = await fn({ questId, storagePath, contentType, reflection });
  return result.data;
}

// organization (own quests) or admin (any quest): approves a pending photo
// submission, awarding the submitter's +5 photo bonus. addToGallery is
// org-quests-only (see approve_photo_submission's own note) — an org can opt
// into adding this photo straight to its public gallery in the same step,
// instead of a separate later call to callAddSubmissionToGallery.
export async function callApprovePhotoSubmission({ questId, userId, addToGallery }) {
  const fn = httpsCallable(functions, 'approve_photo_submission');
  const result = await fn({ questId, userId, addToGallery });
  return result.data;
}

// organization (own quests) or admin (any quest): rejects a pending photo
// submission, optionally with a reason. The submitter can resubmit after this.
export async function callRejectPhotoSubmission({ questId, userId, reason }) {
  const fn = httpsCallable(functions, 'reject_photo_submission');
  const result = await fn({ questId, userId, reason });
  return result.data;
}

// organization: promotes one of its own approved photo submissions into
// its public "Community Photos" gallery (see add_organization_photo).
export async function callAddSubmissionToGallery({ questId, userId }) {
  const fn = httpsCallable(functions, 'add_submission_to_gallery');
  const result = await fn({ questId, userId });
  return result.data;
}

// user: submits a review for a quest the caller checked in to. Rejects
// with ALREADY_EXISTS if this uid already reviewed this quest.
export async function callSubmitReview({ questId, rating, body }) {
  const fn = httpsCallable(functions, 'submit_review');
  const result = await fn({ questId, rating, body });
  return result.data;
}

// user: fetches the caller's own review for a quest, or { review: null }
// if they haven't reviewed it yet.
export async function callGetMyReview(questId) {
  const fn = httpsCallable(functions, 'get_my_review');
  const result = await fn({ questId });
  return result.data;
}

// Any signed-in user (no ownership/role gate on the backend — reviews are
// meant to help anyone deciding whether to attend, see list_quest_reviews's
// own module comment in functions/main.py): lists every review left on a
// quest.
export async function callListQuestReviews(questId) {
  const fn = httpsCallable(functions, 'list_quest_reviews');
  const result = await fn({ questId });
  return result.data.reviews;
}

// Any signed-in user: every organization's public-facing trust tag —
// {orgId, trustStatus}, where trustStatus is 'new' | 'trustworthy' |
// 'under_review' | null. The underlying score/review count never comes
// back at all (see list_organization_trust_tags in functions/main.py) —
// the frontend only ever gets which tag (if any) to render.
export async function callListOrganizationTrustTags() {
  const fn = httpsCallable(functions, 'list_organization_trust_tags');
  const result = await fn();
  return result.data.organizations;
}

// organization (own quests) or admin (any quest): resolves a quest's rsvpd
// uids into {uid, name, email} for display.
export async function callListQuestAttendees(questId) {
  const fn = httpsCallable(functions, 'list_quest_attendees');
  const result = await fn({ questId });
  return result.data.attendees;
}

// user: requests feedback on a quest they actually checked into and feel
// good about — capped at 3 completed requests/month, once per occurrence
// ever. See submit_feedback_request_response for the org's side.
export async function callRequestQuestFeedback(questId) {
  const fn = httpsCallable(functions, 'request_quest_feedback');
  const result = await fn({ questId });
  return result.data;
}

// organization (own quests) or admin (any quest): answers a pending
// feedback request with the fixed 5-question scores plus an optional note
// — this is what actually writes to the leader's journal and, if the
// average clears the threshold, awards their bonus points.
export async function callSubmitFeedbackRequestResponse({ questId, uid, answers, extraThoughts }) {
  const fn = httpsCallable(functions, 'submit_feedback_request_response');
  const result = await fn({ questId, uid, answers, extraThoughts });
  return result.data;
}

// user: marks a journal entry as read (opened), clearing its contribution
// to the BottomNav badge count.
export async function callMarkFeedbackRead(questId) {
  const fn = httpsCallable(functions, 'mark_feedback_read');
  const result = await fn({ questId });
  return result.data;
}

// user: dismisses a one-off popup notice (a quest they'd RSVP'd to was
// rescheduled or cancelled) — deletes it outright, not a read flag; see
// dismiss_notification's own module note for why.
export async function callDismissNotification(notificationId) {
  const fn = httpsCallable(functions, 'dismiss_notification');
  const result = await fn({ notificationId });
  return result.data;
}

// user: saves (or updates) the caller's own private reflection for a quest
// they checked into — independent of whether they've ever requested or
// received feedback for it.
export async function callSubmitQuestReflection({ questId, body }) {
  const fn = httpsCallable(functions, 'submit_quest_reflection');
  const result = await fn({ questId, body });
  return result.data;
}

// user: sets (or clears, with thumbnailUrl: null) the background picture on
// the caller's own journal entry — purely decorative, independent of the
// reflection/feedback on that same entry.
export async function callSetJournalThumbnail({ questId, thumbnailUrl }) {
  const fn = httpsCallable(functions, 'set_journal_thumbnail');
  const result = await fn({ questId, thumbnailUrl });
  return result.data;
}

// organization (own quests) or admin (any quest): saves (or updates) the
// org's own private reflection on how hosting a specific, already-happened
// occurrence went.
export async function callSubmitHostReflection({ questId, body }) {
  const fn = httpsCallable(functions, 'submit_host_reflection');
  const result = await fn({ questId, body });
  return result.data;
}

// organization: sets the org's own location-area and activity-type tags
// (separate from a single quest's tags — these describe the org itself).
export async function callUpdateOrganizationTags({ ltag, etag }) {
  const fn = httpsCallable(functions, 'update_organization_tags');
  const result = await fn({ ltag, etag });
  return result.data;
}

// organization: sets the public-facing profile fields shown on
// OrganizationProfile (logo, mission, city/state, website, contact email,
// social links). Only send the fields actually being changed — omitted
// keys are left untouched server-side.
export async function callUpdateOrganizationProfile(fields) {
  const fn = httpsCallable(functions, 'update_organization_profile');
  const result = await fn(fields);
  return result.data;
}

// organization: adds one already-uploaded photo (storagePath, not a
// resolved URL — see add_organization_photo's own module note) to the
// org's own "Community Photos" gallery. Call after uploadBytes succeeds,
// same two-step upload-then-register flow QuestPhotoSubmission already
// uses for proof photos.
export async function callAddOrganizationPhoto(storagePath) {
  const fn = httpsCallable(functions, 'add_organization_photo');
  const result = await fn({ storagePath });
  return result.data;
}

// organization: removes one photo from its own gallery — deletes the
// actual Storage object too, not just the Firestore array entry.
export async function callRemoveOrganizationPhoto(storagePath) {
  const fn = httpsCallable(functions, 'remove_organization_photo');
  const result = await fn({ storagePath });
  return result.data;
}

// user: changes their accommodation needs and/or location after onboarding.
// Only send the fields actually being changed — omitted keys are left
// untouched server-side (location/placeId/lat/lng travel together or not
// at all).
export async function callUpdateAccommodationNeeds(fields) {
  const fn = httpsCallable(functions, 'update_accommodation_needs');
  const result = await fn(fields);
  return result.data;
}

// user: changes their own display name and/or profile picture (Profile's
// "Edit Profile"). Email/password aren't here — those are Firebase Auth's
// own concern, changed directly against the client SDK (updateEmail/
// updatePassword) rather than through a Cloud Function; see Profile.jsx.
export async function callUpdateUserProfile(fields) {
  const fn = httpsCallable(functions, 'update_user_profile');
  const result = await fn(fields);
  return result.data;
}

// Settings' danger zone: permanently deletes the caller's own account,
// cascading owned quests (organization) or rsvpd entries (everyone else)
// server-side before removing the Auth account itself.
export async function callDeleteAccount() {
  const fn = httpsCallable(functions, 'delete_account');
  const result = await fn();
  return result.data;
}

// Self by default; admin can pass targetUid to look up someone else's rank
// (used by the admin dashboard's Diamond Certifications panel). Returns
// { points, rank, pointsToNextRank }, recomputed server-side from `points`.
export async function callGetUserRank(targetUid) {
  const fn = httpsCallable(functions, 'get_user_rank');
  const result = await fn(targetUid ? { targetUid } : {});
  return result.data;
}

// Self-only: records that the caller has seen these just-earned badges
// (see Badges.jsx), so the "New" ribbon doesn't reappear on a later visit
// or a different device.
export async function callMarkBadgesSeen(badgeIds) {
  const fn = httpsCallable(functions, 'mark_badges_seen');
  const result = await fn({ badgeIds });
  return result.data;
}

// admin: every user who has reached Diamond rank, with whether they've
// already been issued a certificate.
export async function callListDiamondUsers() {
  const fn = httpsCallable(functions, 'list_diamond_users');
  const result = await fn();
  return result.data.users;
}

// admin: manually issues a Diamond certificate to a user (never automatic —
// see the proposal's Admin Dashboard section). Idempotent.
export async function callIssueCertificate(targetUid) {
  const fn = httpsCallable(functions, 'issue_certificate');
  const result = await fn({ targetUid });
  return result.data;
}

// admin: fills in lat/lng for every existing quest that has a placeId but
// no coordinates yet (see EventsMap.jsx) — re-runnable/idempotent, only
// touches quests still missing them. Returns { updated, failedQuestIds }.
export async function callBackfillQuestCoordinates() {
  const fn = httpsCallable(functions, 'backfill_quest_coordinates');
  const result = await fn();
  return result.data;
}

// No auth: /demo-ops's "Seed / Reseed Demo Data" button — self-service
// demo bootstrap (creates/repairs the demo org, Jordan Ortiz, and the
// showcase quest). Safe to call anytime, including before anything has
// ever been seeded.
export async function callDemoSeedShowcase() {
  const fn = httpsCallable(functions, 'demo_seed_showcase');
  const result = await fn({});
  return result.data;
}

// No auth (see functions/main.py's "Demo showcase" section) — backs
// /demo-ops's QR code display, attendee list, and live RSVP/check-in feed.
// Returns { org, quest, attendees, qr }.
export async function callGetDemoOrgView() {
  const fn = httpsCallable(functions, 'get_demo_org_view');
  const result = await fn({});
  return result.data;
}

// No auth: /demo-ops's Reset Event button — clears the demo quest's RSVPs
// and attendance/journal, and reschedules it to right now.
export async function callDemoResetEvent() {
  const fn = httpsCallable(functions, 'demo_reset_event');
  const result = await fn({});
  return result.data;
}

// No auth: called by CheckInConfirm.jsx instead of callCheckInToEvent
// whenever the scanned quest has isDemoQuest set — attributes check-in to
// the fixed demo student regardless of who actually scanned it.
export async function callDemoCheckIn(token) {
  const fn = httpsCallable(functions, 'demo_check_in');
  const result = await fn({ token });
  return result.data;
}

// No auth: /demo-ops's live "Jordan RSVPs" beat — adds her to the demo
// quest's rsvpd list, fired automatically by a live listener the moment
// anyone else RSVPs to the event for real.
export async function callDemoRsvpStudent() {
  const fn = httpsCallable(functions, 'demo_rsvp_student');
  const result = await fn({});
  return result.data;
}

// No auth: /demo-ops's keyboard-shortcut failsafe — a "fake scan" that
// checks Jordan in exactly like a real QR scan would (attendance, points,
// journal entry), just without needing an actual token/camera. For a
// split-screen presentation with no second device free to physically
// scan the QR code.
export async function callDemoForceCheckIn() {
  const fn = httpsCallable(functions, 'demo_force_check_in');
  const result = await fn({});
  return result.data;
}

// No auth: /demo-ops's "Reset Jordan" button — restores her name/duck/
// points/rank to baseline. Doesn't touch RSVPs/attendance/journal; see
// callDemoResetEvent for that (and demo_reset_student's own module note in
// main.py for why the two stay separate).
export async function callDemoResetStudent() {
  const fn = httpsCallable(functions, 'demo_reset_student');
  const result = await fn({});
  return result.data;
}
