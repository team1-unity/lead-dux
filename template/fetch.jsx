// Wrappers around the Cloud Functions defined in functions/main.py.
// httpsCallable(functions, name) doesn't call anything itself — it just
// returns a function you call with the request payload, similar to how
// axios.post(url) returns a promise once you actually invoke it. Firebase
// automatically attaches the caller's ID token to the request, which is
// what req.auth is reading on the Python side.

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebaseapp.jsx';

// Called once, right after Firebase Auth account creation, for both signup
// paths. No admin gate — see functions/main.py for why this is safe to
// expose (the admin-allowlist check happens server-side regardless of what
// the client claims its intent is).
export async function callCompleteSignup(data) {
  const fn = httpsCallable(functions, 'complete_signup');
  const result = await fn(data);
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
