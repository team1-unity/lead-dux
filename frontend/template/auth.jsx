// the single Auth instance, already pointed at the emulator in dev — see
// firebaseapp.jsx
import { auth } from './firebaseapp.jsx';

// the specific auth functions we need from the Firebase SDK
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  confirmPasswordReset,
} from 'firebase/auth';

// authentication logic

// sign in with email and password (returns the full UserCredential — not
// just .user — so callers can inspect it the same way signInWithGoogle's
// callers do; see that function for why that matters)
//
// Firebase checks the email/password against its own servers (no database
// query or password-hashing code needed on our end) and resolves with a
// UserCredential if they match, or throws if they don't — so we `await` it
// the same way we'd `await` a database call in an Express route handler.
export async function signInWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

// sign in with google (returns the full UserCredential)
//
// GoogleAuthProvider just describes *which* external login provider to use.
// signInWithPopup opens a Google sign-in popup and, once the user approves,
// resolves the same way email sign-in above does — except "sign in" and
// "sign up" look identical here (unlike email/password, where creating an
// account is a separate call). Callers that need to tell those apart — e.g.
// org signup, which must never run its role-granting step against someone
// who merely logged into an *existing* account — use
// getAdditionalUserInfo(credential).isNewUser from 'firebase/auth' on the
// value this returns. That's the whole reason this returns the credential
// instead of just the user.
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}

// register a new user with email and password (returns the full UserCredential)
//
// Like the sign-in call above, but this creates the account first. Firebase
// hashes and stores the password on its end (nothing to do here), then logs
// the new user in immediately — resolving the same way signInWithEmail does,
// so callers don't need to treat sign-up any differently.
export async function registerWithEmail(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

// send a password-reset email (the /auth/forgot-password equivalent)
//
// Firebase emails the user a link containing a one-time code (oobCode) that
// points at whatever URL you configure in the Firebase Console's email
// templates — that page is what calls resetPassword below.
export async function sendResetEmail(email) {
  await sendPasswordResetEmail(auth, email);
}

// complete a password reset (the /auth/reset-password equivalent), given the
// oobCode from the link Firebase emailed and the new password the user typed
export async function resetPassword(oobCode, newPassword) {
  await confirmPasswordReset(auth, oobCode, newPassword);
}

// sign the current user out
//
// Equivalent of req.logout() in Express — there's no server-side session to
// destroy here, this just clears the signed-in state the Firebase SDK is
// holding in the browser.
export async function signOutUser() {
  await signOut(auth);
}

// subscribe to login state changes
//
// onAuthStateChanged doesn't return a user directly — it takes a callback
// and calls it immediately with the current user (or null), then calls it
// again every time login state changes. It returns an "unsubscribe"
// function, so whatever calls this is responsible for calling that
// unsubscribe function when it no longer needs updates (e.g. when a React
// component unmounts) — otherwise the callback keeps firing on a component
// that no longer exists.
export function subscribeToAuthChanges(callback) {
  return onAuthStateChanged(auth, callback);
}
