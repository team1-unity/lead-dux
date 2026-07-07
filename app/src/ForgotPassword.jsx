import { useState } from 'react';
import { Link } from 'react-router-dom';
import { sendResetEmail } from '@shared/auth.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';

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
      <div className="box">
        <h1>Check your email</h1>
        <p>If an account exists for {email}, a password reset link is on its way.</p>
        <Link to="/login">Back to login</Link>
      </div>
    );
  }

  return (
    <div className="box">
      <h1>Reset your password</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-md">
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        {error && <p className="box-danger">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Sending...' : 'Send reset link'}
        </button>
      </form>
      <Link to="/login">Back to login</Link>
    </div>
  );
}
