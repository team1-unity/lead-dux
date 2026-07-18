import { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { registerWithEmail, signInWithGoogle } from '@shared/auth.jsx';
import { callCompleteSignup, callSubmitOrganizationRequest } from '@shared/fetch.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';
import { AuthShell } from '@shared/AuthShell.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';

// The account-creation half of organization signup — reached directly from
// the landing page by someone with no account yet. Mirrors mobile/Register,
// but tags the new account accountType: 'organization' so complete_signup
// puts it straight on the onboarding_org branch (never "user"). Once that
// succeeds, refreshRole() flips the parent Register component below into
// its onboarding_org branch automatically — no local "step" state needed.
function SignupStep() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { refreshRole } = useAuth();

  async function handleEmailSignup(e) {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await registerWithEmail(email, password);
      await callCompleteSignup({ accountType: 'organization' });
      await refreshRole();
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignup() {
    setError('');
    setSubmitting(true);
    try {
      const { isNewUser } = await signInWithGoogle();
      if (isNewUser) {
        await callCompleteSignup({ accountType: 'organization' });
      }
      // An existing account signing in here (isNewUser === false) keeps
      // whatever role it already has — Register below sorts out where
      // that role belongs (its own onboarding_org branch, or the
      // already-signed-up message for anything else).
      await refreshRole();
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Sign Up Your Organization"
      footer={
        <>
          <span>
            Already have an account? <Link to="/login">Log in</Link>
          </span>
          <span>
            Not an organization? <Link to="/register">Sign up as a leader</Link>
          </span>
        </>
      }
    >
      <form onSubmit={handleEmailSignup} className="flex flex-col gap-md">
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
        <StampButton type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Creating account...' : 'Continue'}
        </StampButton>
      </form>
      <StampButton type="button" onClick={handleGoogleSignup} disabled={submitting} style={{ marginTop: 10, width: '100%' }}>
        Sign up with Google
      </StampButton>
    </AuthShell>
  );
}

// Two people land here: a brand-new visitor with no account yet (shown
// SignupStep above), and someone partway through an organization signup
// who dropped off before finishing this org-details form (role
// onboarding_org already, from complete_signup). There's no "I'm a 'user'
// who meant to do this" branch anymore — that account type is chosen once,
// at signup, and is permanent; see functions/main.py's state-machine note.
export function Register() {
  const { user, role, loading, refreshRole } = useAuth();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name || !phone || !location || !reason) {
      setError('Organization name, phone, location, and reason are required.');
      return;
    }
    setSubmitting(true);
    try {
      await callSubmitOrganizationRequest({ name, phone, location, reason });
      await refreshRole();
      navigate('/');
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingSpinner />;
  if (!user) return <SignupStep />;

  if (role !== 'onboarding_org') {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthShell title="Register Your Organization">
      <p style={{ marginTop: -8 }}>An admin reviews your request before it's approved.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-md">
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
        {error && <p className="box-danger">{error}</p>}
        <StampButton type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Submitting request...' : 'Request organization account'}
        </StampButton>
      </form>
    </AuthShell>
  );
}
