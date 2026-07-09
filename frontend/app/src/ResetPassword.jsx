import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { resetPassword } from '@shared/auth.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';
import { AuthShell } from '@shared/AuthShell.jsx';
import { StampButton } from '@shared/StampButton.jsx';

// The link Firebase emails from sendResetEmail() lands here with an oobCode
// query param — that code is what proves the click came from the real
// email, not just anyone typing a new password for someone else's account.
export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const oobCode = searchParams.get('oobCode');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(oobCode, password);
      setDone(true);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!oobCode) {
    return (
      <AuthShell title="Invalid reset link">
        <p>This page needs to be opened from the link in your password reset email.</p>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Password updated" footer={<Link to="/login">Log in with your new password</Link>}>
        <p>You're all set.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={handleSubmit} className="flex flex-col gap-md">
        <label>
          New password
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </label>
        <label>
          Confirm new password
          <input type="password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
        </label>
        {error && <p className="box-danger">{error}</p>}
        <StampButton type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Updating...' : 'Update password'}
        </StampButton>
      </form>
    </AuthShell>
  );
}
