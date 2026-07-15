// Wrappers around the Cloud Functions defined in functions/main.py.
// httpsCallable(functions, name) doesn't call anything itself — it just
// returns a function you call with the request payload, similar to how
// axios.post(url) returns a promise once you actually invoke it. Firebase
// automatically attaches the caller's ID token to the request, which is
// what req.auth is reading on the Python side.

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebaseapp.jsx';

// Called once, right after Firebase Auth account creation — the one signup
// path. No admin gate — see functions/main.py for why this is safe to
// expose (the admin-allowlist check happens server-side regardless of what
// the client sends).
export async function callCompleteSignup({ name }) {
  const fn = httpsCallable(functions, 'complete_signup');
  const result = await fn({ name });
  return result.data;
}

// Called once from the onboarding (interests) form. No targetUid — this
// only ever writes the caller's own doc, so there's nothing to escalate.
export async function callSubmitOnboarding({ name, age, interests }) {
  const fn = httpsCallable(functions, 'submit_onboarding');
  const result = await fn({ name, age, interests });
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

// Settings: called by a "user" who wants to register an organization after
// all — flips their role to onboarding_org so /register/organization shows
// the org-details form.
export async function callStartOrganizationOnboarding() {
  const fn = httpsCallable(functions, 'start_organization_onboarding');
  const result = await fn();
  return result.data;
}

// The org-details form's submit, for an account currently onboarding_org
// (whether that's a brand-new org signup or an existing "user" via
// Settings). Creates the ORGREQ and moves the caller to pending_org.
export async function callSubmitOrganizationRequest({ name, phone, location, reason }) {
  const fn = httpsCallable(functions, 'submit_organization_request');
  const result = await fn({ name, phone, location, reason });
  return result.data;
}

// organization: creates a standalone quest owned by the caller's
// organization. eventDate/eventEndTime are ISO datetime strings (see
// EventDateFields) — eventEndTime is optional; the Cloud Function defaults
// the QR expiry to a few hours past eventDate when it's omitted. capacity
// is optional (unlimited if omitted). See callCreateRecurringQuest for
// creating a whole series of dates in one call.
export async function callCreateQuest({ title, description, tags, eventDate, eventEndTime, timezone, location, capacity }) {
  const fn = httpsCallable(functions, 'create_quest');
  const result = await fn({ title, description, tags, eventDate, eventEndTime, timezone, location, capacity });
  return result.data;
}

// organization: creates a whole recurring series in one call — every
// occurrence up to (and including) `until`, spaced by `frequency`
// ('daily' | 'weekly' | 'monthly'). Returns { seriesId, questIds }.
export async function callCreateRecurringQuest({
  title,
  description,
  tags,
  eventDate,
  eventEndTime,
  timezone,
  location,
  capacity,
  frequency,
  until,
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
    capacity,
    frequency,
    until,
  });
  return result.data;
}

// organization (own quest) or admin (own default quest): turns an existing
// standalone quest into the first occurrence of a recurring series,
// generating the remaining dates. Rejects if it's already part of a series.
export async function callMakeQuestRecurring({ questId, frequency, until }) {
  const fn = httpsCallable(functions, 'make_quest_recurring');
  const result = await fn({ questId, frequency, until });
  return result.data;
}

// admin: creates a quest with no owning organization, shown to everyone.
export async function callCreateDefaultQuest({ title, description, tags, eventDate, eventEndTime, timezone, location, capacity }) {
  const fn = httpsCallable(functions, 'create_default_quest');
  const result = await fn({ title, description, tags, eventDate, eventEndTime, timezone, location, capacity });
  return result.data;
}

// organization (own quests) or admin (any quest): deletes just this one
// occurrence. See callDeleteQuestSeries to remove a whole recurring series.
export async function callDeleteQuest(questId) {
  const fn = httpsCallable(functions, 'delete_quest');
  const result = await fn({ questId });
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
  return result.data;
}

// user: adds the caller's uid to a quest's rsvpd list.
export async function callRsvpToQuest(questId) {
  const fn = httpsCallable(functions, 'rsvp_to_quest');
  const result = await fn({ questId });
  return result.data;
}

// user: removes the caller's uid from a quest's rsvpd list.
export async function callCancelRsvp(questId) {
  const fn = httpsCallable(functions, 'cancel_rsvp');
  const result = await fn({ questId });
  return result.data;
}

// user: re-fetches the caller's own check-in QR code for a quest they've
// already RSVP'd to (rsvp_to_quest returns the same shape the first time).
export async function callGetQuestQr(questId) {
  const fn = httpsCallable(functions, 'get_quest_qr');
  const result = await fn({ questId });
  return result.data;
}

// organization (own quests) or admin (any quest): validates a scanned QR
// code's {questId, uid, token} payload and marks that attendee checked in.
export async function callCheckInAttendee({ questId, uid, token }) {
  const fn = httpsCallable(functions, 'check_in_attendee');
  const result = await fn({ questId, uid, token });
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

// organization (own quests) or admin (any quest): lists every review left
// on a quest.
export async function callListQuestReviews(questId) {
  const fn = httpsCallable(functions, 'list_quest_reviews');
  const result = await fn({ questId });
  return result.data.reviews;
}

// organization (own quests) or admin (any quest): resolves a quest's rsvpd
// uids into {uid, name, email} for display.
export async function callListQuestAttendees(questId) {
  const fn = httpsCallable(functions, 'list_quest_attendees');
  const result = await fn({ questId });
  return result.data.attendees;
}

// organization (own quests) or admin (any quest): AI-drafted feedback (a
// default rating + a generated message) for every checked-in attendee who
// doesn't already have feedback for this quest. Nothing is persisted by
// this call — see callSubmitQuestFeedbackBatch for the actual send.
export async function callGenerateQuestFeedbackDrafts(questId) {
  const fn = httpsCallable(functions, 'generate_quest_feedback_drafts');
  const result = await fn({ questId });
  return result.data;
}

// organization (own quests) or admin (any quest): persists the org's
// (possibly edited) feedback for a batch of attendees at once — this is
// what actually writes to each attendee's journal and awards their bonus
// points.
export async function callSubmitQuestFeedbackBatch({ questId, feedback }) {
  const fn = httpsCallable(functions, 'submit_quest_feedback_batch');
  const result = await fn({ questId, feedback });
  return result.data;
}

// user: acknowledges the live "you got feedback" popup for one quest, so it
// doesn't show again on a later page load. Doesn't affect the journal's
// unread badge — see callMarkFeedbackRead for that.
export async function callMarkFeedbackNotified(questId) {
  const fn = httpsCallable(functions, 'mark_feedback_notified');
  const result = await fn({ questId });
  return result.data;
}

// user: marks a journal entry as read (opened), clearing its contribution
// to the BottomNav badge count.
export async function callMarkFeedbackRead(questId) {
  const fn = httpsCallable(functions, 'mark_feedback_read');
  const result = await fn({ questId });
  return result.data;
}

// user: saves (or updates) the caller's own private reflection for a quest
// they've already received organization feedback on.
export async function callSubmitQuestReflection({ questId, body }) {
  const fn = httpsCallable(functions, 'submit_quest_reflection');
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

// user: changes their interests after onboarding (onboarding only sets
// them once).
export async function callUpdateInterests({ interests }) {
  const fn = httpsCallable(functions, 'update_interests');
  const result = await fn({ interests });
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
