import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getAdditionalUserInfo } from 'firebase/auth';
import { registerWithEmail, signInWithGoogle, signOutUser } from '@shared/auth.jsx';
import { callCompleteSignup } from '@shared/fetch.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';

export function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { refreshRole } = useAuth();

  async function handleEmailRegister(e) {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await registerWithEmail(email, password);
      await callCompleteSignup({ intent: 'public', name });
      await refreshRole();
      navigate('/');
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleRegister() {
    setError('');
    setSubmitting(true);
    try {
      const credential = await signInWithGoogle();
      if (getAdditionalUserInfo(credential)?.isNewUser) {
        await callCompleteSignup({ intent: 'public', name });
        await refreshRole();
      } else {
        // Existing account signing back in via the "sign up" button —
        // calling complete_signup again would reset their onboarding
        // progress. Just send them to Home as a normal login.
      }
      navigate('/');
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="box">
      <h1>Sign Up</h1>
      <form onSubmit={handleEmailRegister} className="flex flex-col gap-md">
        <label>
          Name
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label>
          Password
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </label>
        <label>
          Confirm password
          <input type="password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
        </label>
        {error && <p className="box-danger">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating account...' : 'Create account'}
        </button>
      </form>
      <button onClick={handleGoogleRegister} disabled={submitting}>
        Sign up with Google
      </button>
      <p>
        Signing up on behalf of an organization? <Link to="/register/organization">Register your organization</Link>
      </p>
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
