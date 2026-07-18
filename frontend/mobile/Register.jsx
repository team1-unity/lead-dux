import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { registerWithEmail, signInWithGoogle } from '@shared/auth.jsx';
import { callCompleteSignup } from '@shared/fetch.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';
import { AuthShell } from '@shared/AuthShell.jsx';
import { StampButton } from '@shared/StampButton.jsx';

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
      await callCompleteSignup({ name });
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
      const { isNewUser } = await signInWithGoogle();
      if (isNewUser) {
        await callCompleteSignup({ name });
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
    <AuthShell
      title="Sign Up"
      footer={
        <>
          <span>
            Already have an account? <Link to="/login">Log in</Link>
          </span>
          <span>
            Represent an organization? <Link to="/register/organization">Sign up here</Link>
          </span>
        </>
      }
    >
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
        <StampButton type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Creating account...' : 'Create account'}
        </StampButton>
      </form>
      <StampButton type="button" onClick={handleGoogleRegister} disabled={submitting} style={{ marginTop: 10, width: '100%' }}>
        Sign up with Google
      </StampButton>
    </AuthShell>
  );
}
