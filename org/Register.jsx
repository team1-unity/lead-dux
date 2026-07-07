import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getAdditionalUserInfo } from 'firebase/auth';
import { registerWithEmail, signInWithGoogle, signOutUser } from '@shared/auth.jsx';
import { callCompleteSignup } from '@shared/fetch.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';

export function Register() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { refreshRole } = useAuth();

  const orgFieldsMissing = !name || !phone || !location || !reason;

  async function requestOrganization() {
    await callCompleteSignup({ intent: 'organization', name, phone, location, reason });
    await refreshRole();
  }

  async function handleEmailRegister(e) {
    e.preventDefault();
    setError('');
    if (orgFieldsMissing) {
      setError('Organization name, phone, location, and reason are required.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await registerWithEmail(email, password);
      await requestOrganization();
      navigate('/');
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleRegister() {
    setError('');
    if (orgFieldsMissing) {
      setError('Fill in organization name, phone, location, and reason before continuing with Google.');
      return;
    }
    setSubmitting(true);
    try {
      const credential = await signInWithGoogle();
      if (getAdditionalUserInfo(credential)?.isNewUser) {
        // Fresh account — this really is a signup.
        await requestOrganization();
      } else {
        // signInWithPopup logs an EXISTING account in rather than creating
        // one — if we called requestOrganization here, we'd silently
        // overwrite whatever role that account already had (set_custom_user_claims
        // replaces the whole claims object). Treat this as a normal login instead.
        await signOutUser().then(() => {
          throw new Error('EXISTING_ACCOUNT');
        });
      }
      navigate('/');
    } catch (err) {
      if (err.message === 'EXISTING_ACCOUNT') {
        setError('That Google account already exists — log in instead.');
      } else {
        setError(getAuthErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="box">
      <h1>Register Your Organization</h1>
      <p>Anyone can request an organization account — an admin reviews your request before it's approved.</p>
      <form onSubmit={handleEmailRegister} className="flex flex-col gap-md">
        <label>
          Organization name
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Phone
          <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label>
          Location
          <input type="text" required value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label>
          What do you hope to get out of this?
          <textarea required value={reason} onChange={(e) => setReason(e.target.value)} />
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
          {submitting ? 'Submitting request...' : 'Request organization account'}
        </button>
      </form>
      <button onClick={handleGoogleRegister} disabled={submitting}>
        Continue with Google
      </button>
      <p>
        Not an organization? <Link to="/register">Sign up as a public user</Link>
      </p>
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
