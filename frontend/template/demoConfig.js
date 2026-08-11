// Fixed demo account credentials — must exactly match functions/main.py's
// DEMO_ORG_EMAIL/DEMO_STUDENT_EMAIL/DEMO_PASSWORD (kept in sync by hand,
// same cross-file-pair convention as duckSkins.js/accommodations.js).
//
// Safe to ship client-side: both accounts are fake, low-privilege demo
// personas that exist only to be signed into from /demo-org and
// /demo-stud — there's no real data behind either of them worth
// protecting with a secret password. Signing in directly with email+
// password (rather than minting a custom auth token server-side) also
// sidesteps a real Cloud Functions gotcha: admin.auth().createCustomToken()
// has to sign the token via the IAM signBlob API when running without a
// service account key (the normal Cloud Functions case), which the
// runtime service account isn't granted by default — a project-level IAM
// change, not something worth requiring just to log into two fixed demo
// accounts.
export const DEMO_ORG_EMAIL = 'dgi@lead-dux.app';
export const DEMO_STUDENT_EMAIL = 'jordan.ortiz@lead-dux.app';
export const DEMO_PASSWORD = 'password123';
