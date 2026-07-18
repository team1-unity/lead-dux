// the single Auth instance, already pointed at the emulator in dev — see
// firebaseapp.jsx
import { auth } from './firebaseapp.jsx';

// the specific auth functions we need from the Firebase SDK
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  getAdditionalUserInfo,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  confirmPasswordReset,
} from 'firebase/auth';

// Only actually used on native platforms (see signInWithGoogle below) — a
// plain web build never touches this import at runtime, but Capacitor/Vite
// still need it resolvable at build time.
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';

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

// sign in with google (returns { user, isNewUser })
//
// signInWithPopup doesn't work inside a Capacitor WebView at all — Google
// blocks OAuth sign-in in embedded webviews outright, popup or redirect —
// so this branches on platform:
//
// - Web: the usual GoogleAuthProvider + signInWithPopup flow.
// - Native: @capacitor-firebase/authentication drives the actual on-device
//   Google account picker. capacitor.config.json sets skipNativeAuth: true
//   for this plugin specifically so it does *only* that handshake and hands
//   back a Google ID token, rather than also silently signing into a
//   separate native-only Firebase session — this line then completes the
//   sign-in through the exact same firebase/auth JS `auth` instance the web
//   path uses, via signInWithCredential. That keeps onAuthStateChanged,
//   getIdTokenResult()'s custom claims, and every other AuthContext.jsx
//   assumption identical across both platforms; nothing downstream needs to
//   know or care that the credential came from a native picker.
//
// Callers get a normalized { user, isNewUser } back either way, instead of
// each call site having to know that web calls need getAdditionalUserInfo()
// on a UserCredential while native calls need the plugin's own differently
// shaped result.
export async function signInWithGoogle() {
  if (Capacitor.isNativePlatform()) {
    const result = await FirebaseAuthentication.signInWithGoogle();
    const idToken = result.credential?.idToken;
    if (!idToken) {
      throw new Error('Google sign-in was cancelled.');
    }
    const jsResult = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    return { user: jsResult.user, isNewUser: getAdditionalUserInfo(jsResult)?.isNewUser ?? false };
  }

  const provider = new GoogleAuthProvider();
  const jsResult = await signInWithPopup(auth, provider);
  return { user: jsResult.user, isNewUser: getAdditionalUserInfo(jsResult)?.isNewUser ?? false };
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
