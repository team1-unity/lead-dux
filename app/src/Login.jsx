import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { signInWithEmail, signInWithGoogle, signOutUser } from '@shared/auth.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';

// Firebase Auth has no idea what "suspended" means — that's app data, not
// login data — so this checks it right after authenticating, before
// letting the user through to Home. Only public users have this field
// today; organizations/admins don't, so a missing doc just means "not
// suspended," not an error.
async function rejectIfSuspended(user) {
  const snap = await getDoc(doc(db, 'users', user.uid));
  if (snap.exists() && snap.data().isSuspended) {
    await signOutUser();
    throw new Error('SUSPENDED');
  }
}

// One shared login for all three roles — no role branching happens here at
// all. After a successful sign-in this always navigates to '/', and Home
// (in App.jsx) is the single place that reads the account's role and
// decides which interface (admin/org/public) to actually show.
export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleEmailLogin(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { user } = await signInWithEmail(email, password);
      await rejectIfSuspended(user);
      navigate('/');
    } catch (err) {
      setError(err.message === 'SUSPENDED' ? 'Your account has been suspended.' : getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleLogin() {
    setError('');
    setSubmitting(true);
    try {
      const { user } = await signInWithGoogle();
      await rejectIfSuspended(user);
      navigate('/');
    } catch (err) {
      setError(err.message === 'SUSPENDED' ? 'Your account has been suspended.' : getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="box">
      <h1>Log In</h1>
      <form onSubmit={handleEmailLogin} className="flex flex-col gap-md">
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label>
          Password
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="box-danger">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in...' : 'Log in'}
        </button>
      </form>
      <button onClick={handleGoogleLogin} disabled={submitting}>
        Sign in with Google
      </button>
      <p>
        <Link to="/forgot-password">Forgot password?</Link>
      </p>
      <p>
        New here? <Link to="/register">Sign up</Link> or <Link to="/register/organization">register an organization</Link>
      </p>
    </div>
  );
}
