import { useState } from 'react';
import { Link } from 'react-router-dom';
import { sendResetEmail } from '@shared/auth.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';
import { AuthShell } from '@shared/AuthShell.jsx';
import { StampButton } from '@shared/StampButton.jsx';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await sendResetEmail(email);
      setSent(true);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthShell title="Check your email" footer={<Link to="/login">Back to login</Link>}>
        <p>If an account exists for {email}, a password reset link is on its way.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" footer={<Link to="/login">Back to login</Link>}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-md">
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        {error && <p className="box-danger">{error}</p>}
        <StampButton type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Sending...' : 'Send reset link'}
        </StampButton>
      </form>
    </AuthShell>
  );
}
