// React Context that wraps the app and keeps track of:
//   - the current logged-in user (or null)
//   - their role: one of onboarding_user, user, onboarding_org, pending_org,
//     organization, admin (see functions/main.py for the full state machine)
//   - whether Firebase has finished figuring out the initial auth state
//
// Any component can call useAuth() to read this instead of passing it down
// through props.

import { createContext, useContext, useEffect, useState } from 'react';
import { subscribeToAuthChanges, signOutUser } from './auth.jsx';
import { auth } from './firebaseapp.jsx';

const AuthContext = createContext({
  user: null,
  role: null,
  loading: true,
  logout: async () => {},
  refreshRole: async () => {},
});

// Wrap your app with this once, e.g. in main.jsx: <AuthProvider><App /></AuthProvider>
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  // Shared by the onAuthStateChanged listener below and refreshRole() — both
  // need to turn "a Firebase user" into "our state" the same way.
  async function applyUser(firebaseUser) {
    if (firebaseUser) {
      // The user object itself has no role — roles live in custom claims
      // on the ID token. force-refresh (the `true` argument) so we don't
      // read a cached token from before a role was granted.
      const tokenResult = await firebaseUser.getIdTokenResult(true);
      setUser(firebaseUser);
      // No claim yet means complete_signup hasn't run (a brief window right
      // after account creation) — treat that the same as onboarding_user,
      // the least-privileged real state, rather than granting more.
      setRole(tokenResult.claims.role || 'onboarding_user');
    } else {
      setUser(null);
      setRole(null);
    }
  }

  useEffect(() => {
    // Fires immediately with the current user (or null on page load), then
    // again every time login state changes.
    const unsubscribe = subscribeToAuthChanges(async (firebaseUser) => {
      await applyUser(firebaseUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Cloud Functions that grant a role (e.g. register_as_organization) change
  // it on Firebase's servers, but onAuthStateChanged does NOT refire just
  // because a claim changed — it only fires on sign-in/sign-out/token
  // expiry. Call this right after such a function succeeds so `role` in
  // this context is correct immediately, instead of stale until next reload.
  async function refreshRole() {
    if (auth.currentUser) {
      await applyUser(auth.currentUser);
    }
  }

  return (
    <AuthContext.Provider value={{ user, role, loading, logout: signOutUser, refreshRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
