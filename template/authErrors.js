// Firebase throws errors with codes like "auth/wrong-password" — this maps
// the ones users will actually hit to plain-language messages. Anything not
// listed falls back to a generic message rather than showing Firebase's
// internal wording.

const MESSAGES = {
  'auth/email-already-in-use': 'An account with that email already exists. Try logging in instead.',
  'auth/invalid-email': 'That doesn\'t look like a valid email address.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/too-many-requests': 'Too many attempts. Please wait a bit and try again.',
  'auth/popup-closed-by-user': 'Sign-in was cancelled.',
  'auth/expired-action-code': 'This password reset link has expired. Request a new one.',
  'auth/invalid-action-code': 'This password reset link is invalid or has already been used.',
};

export function getAuthErrorMessage(error) {
  return MESSAGES[error?.code] || 'Something went wrong. Please try again.';
}
