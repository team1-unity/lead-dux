import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@shared/AuthContext.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { callUpdateInterests } from '@shared/fetch.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';
import { TopBar } from '@shared/TopBar.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { StatusStamp } from '@shared/StatusStamp.jsx';
import { TagStamp } from '@shared/TagStamp.jsx';
import { IconChevron } from '@shared/icons.jsx';
import { INTEREST_OPTIONS } from '@shared/interests.js';

// Lets a "user" change the interests they picked during onboarding —
// onboarding only ever sets them once, this is the only way back in.
function InterestsEditor() {
  const { user } = useAuth();
  const [interests, setInterests] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      setInterests(snap.exists() ? snap.data().interests || [] : []);
    });
  }, [user]);

  function toggle(interest) {
    setSaved(false);
    setInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  }

  async function save() {
    setError('');
    if (interests.length === 0) {
      setError('Pick at least one interest.');
      return;
    }
    setSubmitting(true);
    try {
      await callUpdateInterests({ interests });
      setSaved(true);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (interests === null) return <LoadingSpinner label="Loading interests..." />;

  return (
    <section className="ink-card" style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ marginBottom: 0 }}>Interests</h2>
      <p style={{ margin: 0 }}>These decide which quests show up first for you.</p>
      <div className="flex flex-wrap gap-sm">
        {INTEREST_OPTIONS.map((interest) => (
          <TagStamp
            key={interest}
            tone={interest}
            selectable
            selected={interests.includes(interest)}
            onClick={() => toggle(interest)}
          >
            {interest}
          </TagStamp>
        ))}
      </div>
      {error && <p className="box-danger">{error}</p>}
      <StampButton type="button" variant="primary" onClick={save} disabled={submitting}>
        {submitting ? 'Saving...' : saved ? 'Saved!' : 'Save interests'}
      </StampButton>
    </section>
  );
}

// The "your account" hub: identity, interests (role "user" only), and
// wherever the caller stands in the organization-registration flow — plus
// signing out. Settings, by contrast, is purely display preferences and
// account deletion; this split keeps "things about me" separate from
// "things about how the app looks/whether I keep my account."
export function Profile() {
  const { user, role, loading, logout } = useAuth();

  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <PageMotion>
      <TopBar title="Profile" />

      <div className="ink-card" style={{ marginBottom: 16 }}>
        <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--line-soft)' }}>
          Signed in as
        </p>
        <p style={{ margin: '2px 0 0', fontWeight: 700 }}>{user.email}</p>
      </div>

      {role === 'user' && <InterestsEditor />}

      {role !== 'user' && (
        <section className="ink-card" style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ marginBottom: 0 }}>Organization</h2>

          {role === 'onboarding_org' && (
            <div className="flex justify-between items-center">
              <div>
                <StatusStamp muted>IN PROGRESS</StatusStamp>
                <p style={{ margin: '8px 0 0' }}>You started registering an organization.</p>
              </div>
              <Link to="/register/organization" aria-label="Finish your application">
                <IconChevron style={{ transform: 'rotate(-90deg)' }} />
              </Link>
            </div>
          )}

          {role === 'pending_org' && (
            <div>
              <StatusStamp tone="outdoors">UNDER REVIEW</StatusStamp>
              <p style={{ margin: '8px 0 0' }}>Your organization application is awaiting admin review.</p>
            </div>
          )}

          {role === 'organization' && (
            <div className="flex justify-between items-center">
              <div>
                <StatusStamp tone="education">APPROVED</StatusStamp>
                <p style={{ margin: '8px 0 0' }}>You already manage an organization.</p>
              </div>
              <Link to="/org" aria-label="Go to your organization dashboard">
                <IconChevron style={{ transform: 'rotate(-90deg)' }} />
              </Link>
            </div>
          )}

          {role === 'admin' && (
            <div>
              <StatusStamp tone="community">FULL ACCESS</StatusStamp>
              <p style={{ margin: '8px 0 0' }}>
                You manage the whole platform from the <Link to="/admin">admin data page</Link>.
              </p>
            </div>
          )}
        </section>
      )}

      <StampButton type="button" variant="danger" onClick={logout} style={{ width: '100%' }}>
        Log out
      </StampButton>
    </PageMotion>
  );
}
