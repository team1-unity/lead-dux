import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@shared/AuthContext.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { callStartOrganizationOnboarding, callUpdateInterests } from '@shared/fetch.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { StatusStamp } from '@shared/StatusStamp.jsx';
import { TagStamp } from '@shared/TagStamp.jsx';
import { DuckMark } from '@shared/Logo.jsx';
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
    <section className="ink-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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

// No profile photo upload exists in this app (users have no avatar field) —
// the duck mascot in a brand-mustard ring is the deliberate placeholder for
// every account, rather than an initial-based tile (which would make this
// read like an org's avatar, a color-per-entity system that doesn't fit a
// personal profile).
function UserAvatar() {
  return (
    <div className="user-avatar" aria-hidden="true">
      <DuckMark size={40} />
    </div>
  );
}

// The "your account" hub: identity, interests (role "user" only), and
// wherever the caller stands in the organization-registration flow — plus
// signing out. Settings, by contrast, is purely display preferences and
// account deletion; this split keeps "things about me" separate from
// "things about how the app looks/whether I keep my account."
export function Profile() {
  const { user, role, loading, logout, refreshRole } = useAuth();
  const [name, setName] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      setName(snap.exists() ? snap.data().name || '' : '');
    });
  }, [user]);

  if (loading) return <LoadingSpinner />;
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
    <PageMotion>
      <div className="ink-card profile-identity">
        <UserAvatar />
        <div className="profile-identity-info">
          <h1>{name || 'Your profile'}</h1>
          <p className="profile-meta">Signed in as {user.email}</p>
        </div>
        <StampButton type="button" onClick={logout} className="profile-logout">
          Log out
        </StampButton>
      </div>

      <div className="profile-grid">
        {role === 'user' && <InterestsEditor />}

        <section className="ink-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ marginBottom: 0 }}>Organization</h2>

          {role === 'user' && (
            <>
              <p style={{ margin: 0 }}>Signed up as a regular member but meant to register an organization?</p>
              <StampButton type="button" variant="primary" onClick={registerAsOrganization} disabled={submitting}>
                {submitting ? 'Starting...' : 'Register your organization'}
              </StampButton>
            </>
          )}

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

          {error && <p className="box-danger">{error}</p>}
        </section>
      </div>
    </PageMotion>
  );
}
