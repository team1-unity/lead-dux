import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@shared/AuthContext.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { callUpdateInterests, callUpdateOrganizationTags } from '@shared/fetch.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { StatusStamp } from '@shared/StatusStamp.jsx';
import { TagStamp } from '@shared/TagStamp.jsx';
import { DuckMark } from '@shared/Logo.jsx';
import { IconChevron } from '@shared/icons.jsx';
import { INTEREST_OPTIONS } from '@shared/interests.js';
import { hashTone } from '@shared/tagTones.js';
import { rankForPoints, pointsToNextRank } from '@shared/rank.js';

// Points/rank are read straight off the user's own doc (self-readable, see
// firestore.rules) — no dedicated Cloud Function needed just to display
// them. Rank itself is never stored; see rank.js for why.
function ProgressCard() {
  const { user } = useAuth();
  const [points, setPoints] = useState(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      setPoints(snap.exists() ? snap.data().points || 0 : 0);
    });
  }, [user]);

  if (points === null) return null;

  const rank = rankForPoints(points);
  const toNext = pointsToNextRank(points);

  return (
    <section className="ink-card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <h2 style={{ marginBottom: 0 }}>Leadership Progress</h2>
      <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.4rem', textTransform: 'uppercase' }}>
        {rank}
      </p>
      <p className="data-stat" style={{ marginTop: 4 }}>
        {points} point{points === 1 ? '' : 's'}
        {toNext !== null ? ` — ${toNext} to ${rankForPoints(points + toNext)}` : ' — top rank reached'}
      </p>
    </section>
  );
}

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

// Lets an organization set the location areas and activity/event types it
// operates in — separate from a single quest's own tags, these describe
// the org itself (for future browse/filter-by-org features). Lives on
// Profile (an org's "who we are" info) rather than the Quests dashboard,
// which is purely quest browsing/management.
function OrgTags({ org, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [ltagInput, setLtagInput] = useState((org.ltag || []).join(', '));
  const [etagInput, setEtagInput] = useState((org.etag || []).join(', '));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function save(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const ltag = ltagInput.split(',').map((t) => t.trim()).filter(Boolean);
      const etag = etagInput.split(',').map((t) => t.trim()).filter(Boolean);
      await callUpdateOrganizationTags({ ltag, etag });
      onSaved({ ltag, etag });
      setEditing(false);
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing) {
    const ltag = org.ltag || [];
    const etag = org.etag || [];
    return (
      <section className="ink-card">
        <div className="section-heading">
          <h2 style={{ margin: 0 }}>Locations &amp; Activities</h2>
          <StampButton type="button" onClick={() => setEditing(true)} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
            Edit
          </StampButton>
        </div>
        {ltag.length === 0 && etag.length === 0 ? (
          <p className="data-stat" style={{ margin: '10px 0 0' }}>Not set yet.</p>
        ) : (
          <div className="quest-tags" style={{ marginTop: 10 }}>
            {ltag.map((t) => <TagStamp key={`l-${t}`} tone={hashTone(t)}>{t}</TagStamp>)}
            {etag.map((t) => <TagStamp key={`e-${t}`} tone={hashTone(t)}>{t}</TagStamp>)}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="ink-card">
      <h2 style={{ marginTop: 0 }}>Locations &amp; Activities</h2>
      <form onSubmit={save} className="flex flex-col gap-md">
        <label>
          Location areas (comma separated)
          <input value={ltagInput} onChange={(e) => setLtagInput(e.target.value)} placeholder="Downtown, Riverside" />
        </label>
        <label>
          Activity types (comma separated)
          <input value={etagInput} onChange={(e) => setEtagInput(e.target.value)} placeholder="Cleanup, Workshop" />
        </label>
        {error && <p className="box-danger">{error}</p>}
        <div className="flex gap-sm">
          <StampButton type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save'}
          </StampButton>
          <StampButton type="button" onClick={() => setEditing(false)} disabled={submitting}>
            Cancel
          </StampButton>
        </div>
      </form>
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

// The "your account" hub: identity, rank progress + interests (role "user"
// only), and wherever the caller stands in the organization-registration
// flow — plus signing out. Settings, by contrast, is purely display
// preferences and account deletion; this split keeps "things about me"
// separate from "things about how the app looks/whether I keep my
// account." Organizations now sign up directly from the landing page
// rather than converting from a regular user account, so there's no
// "become an organization" prompt here anymore — only the four states a
// caller already in that pipeline (or already an org/admin) can be in.
export function Profile() {
  const { user, role, loading, logout } = useAuth();
  const [name, setName] = useState(null);
  const [org, setOrg] = useState(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      setName(snap.exists() ? snap.data().name || '' : '');
    });
  }, [user]);

  // Only an approved 'organization' account has a populated organizations/
  // doc (About/Locations & Activities) — every other role skips this read.
  useEffect(() => {
    if (role !== 'organization' || !user) return;
    getDoc(doc(db, 'organizations', user.uid)).then((snap) => {
      if (snap.exists()) setOrg(snap.data());
    });
  }, [role, user]);

  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/login" replace />;

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
        {role === 'user' && <ProgressCard />}
        {role === 'user' && <InterestsEditor />}

        {role !== 'user' && (
          <section className="ink-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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

        {role === 'organization' && org && (
          <>
            <section className="ink-card">
              <h2 style={{ marginTop: 0 }}>About</h2>
              <p style={{ margin: 0 }}>{org.reason}</p>
              <p className="data-stat" style={{ marginTop: 10 }}>{org.location}</p>
              <p className="data-stat">{org.phone}</p>
            </section>
            <OrgTags org={org} onSaved={(t) => setOrg((prev) => ({ ...prev, ...t }))} />
          </>
        )}
      </div>
    </PageMotion>
  );
}
