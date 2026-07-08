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

// organization: creates a quest owned by the caller's organization.
export async function callCreateQuest({ title, description, tags }) {
  const fn = httpsCallable(functions, 'create_quest');
  const result = await fn({ title, description, tags });
  return result.data;
}

// admin: creates a quest with no owning organization, shown to everyone.
export async function callCreateDefaultQuest({ title, description, tags }) {
  const fn = httpsCallable(functions, 'create_default_quest');
  const result = await fn({ title, description, tags });
  return result.data;
}

// organization (own quests) or admin (any quest): deletes a quest.
export async function callDeleteQuest(questId) {
  const fn = httpsCallable(functions, 'delete_quest');
  const result = await fn({ questId });
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

// organization (own quests) or admin (any quest): resolves a quest's rsvpd
// uids into {uid, name, email} for display.
export async function callListQuestAttendees(questId) {
  const fn = httpsCallable(functions, 'list_quest_attendees');
  const result = await fn({ questId });
  return result.data.attendees;
}
