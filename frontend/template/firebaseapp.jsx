// initialize and export firebase app, plus the Auth/Firestore/Functions
// instances every other template/ file and every app builds on.

import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, connectStorageEmulator } from "firebase/storage";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
export const firebaseConfig = {
  apiKey: "AIzaSyABniQCelPg-ykVuWncKdvOtgzK15ZIs18",
  authDomain: "lead-dux.firebaseapp.com",
  projectId: "lead-dux",
  storageBucket: "lead-dux.firebasestorage.app",
  messagingSenderId: "19713060365",
  appId: "1:19713060365:web:421ae146cbc86873546f44",
  measurementId: "G-LM1CPP1E3P"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);

// Emulators are opt-in, not automatic-in-dev. Firestore's security rules
// only trust a caller's Auth token if Firestore validates it against the
// same source that issued it — the local Auth emulator's tokens are fake
// and unsigned, so real Firestore always rejects them, and the local
// Firestore emulator only trusts the local Auth emulator's tokens. That
// means Auth/Firestore/Functions have to be ALL emulated or ALL real
// together; there's no working mix. Set VITE_USE_FIREBASE_EMULATORS=true in
// a .env.local file (per app) to switch all three to local at once.
if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}