import { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { callSubmitOrganizationRequest } from '@shared/fetch.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';

// Reachable only by an already-signed-up "user" partway through registering
// an organization (role onboarding_org, set by Settings' "register your
// organization" button). There's no anonymous signup path anymore —
// everyone signs in with Google and does the basic onboarding first.
export function Register() {
  const { user, role, refreshRole } = useAuth();
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

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (role === 'user') {
    return (
      <div className="box">
        <p>
          Go to <Link to="/settings">Settings</Link> to register your organization.
        </p>
      </div>
    );
  }

  if (role !== 'onboarding_org') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="box">
      <h1>Register Your Organization</h1>
      <p>An admin reviews your request before it's approved.</p>
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
        <button type="submit" disabled={submitting}>
          {submitting ? 'Submitting request...' : 'Request organization account'}
        </button>
      </form>
    </div>
  );
}
