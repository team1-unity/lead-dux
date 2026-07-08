import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@shared/AuthContext.jsx';
import { callStartOrganizationOnboarding } from '@shared/fetch.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';

// Reachable by any signed-in role. The one action here today is letting a
// "user" who signed up as a regular member start registering an
// organization — every other role just sees where things stand.
export function Settings() {
  const { user, role, loading, logout, refreshRole } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  if (loading) return <p>Loading...</p>;
  if (!user) return <Navigate to="/login" replace />;

  async function registerAsOrganization() {
    setError('');
    setSubmitting(true);
    try {
      await callStartOrganizationOnboarding();
      await refreshRole();
      navigate('/register/organization');
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="box">
      <h1>Settings</h1>
      <p>Signed in as {user.email}</p>

      <section className="box-secondary">
        <h2>Organization</h2>
        {role === 'user' && (
          <>
            <p>Signed up as a regular member but meant to register an organization?</p>
            <button onClick={registerAsOrganization} disabled={submitting}>
              {submitting ? 'Starting...' : 'Register your organization'}
            </button>
          </>
        )}
        {role === 'onboarding_org' && (
          <p>
            You started registering an organization —{' '}
            <Link to="/register/organization">finish your application</Link>.
          </p>
        )}
        {role === 'pending_org' && <p>Your organization application is awaiting admin review.</p>}
        {role === 'organization' && (
          <p>
            You already manage an organization — see your{' '}
            <Link to="/org">organization dashboard</Link>.
          </p>
        )}
        {error && <p className="box-danger">{error}</p>}
      </section>

      <p><Link to="/">Back to quests</Link></p>
      <button onClick={logout}>Log out</button>
    </div>
  );
}
