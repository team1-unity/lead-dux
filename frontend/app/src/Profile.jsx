import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@shared/AuthContext.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { callUpdateInterests, callUpdateAccommodationNeeds, callUpdateOrganizationTags, callUpdateOrganizationProfile } from '@shared/fetch.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { StatusStamp } from '@shared/StatusStamp.jsx';
import { TagStamp } from '@shared/TagStamp.jsx';
import { PlaceAutocompleteInput } from '@shared/PlaceAutocompleteInput.jsx';
import { DuckMark } from '@shared/Logo.jsx';
import { TrustTag } from '@shared/TrustTag.jsx';
import { getTrustStatus } from '@shared/questSeries.js';
import { IconCheck, IconChevron, IconLock } from '@shared/icons.jsx';
import { INTEREST_OPTIONS } from '@shared/interests.js';
import { ACCOMMODATION_OPTIONS } from '@shared/accommodations.js';
import { hashTone } from '@shared/tagTones.js';
import { allRanks, rankForPoints } from '@shared/rank.js';
import { RankProgressCard } from '@shared/RankProgressCard.jsx';

// Points/rank/certificateIssued are read straight off the user's own doc
// (self-readable, see firestore.rules) — no dedicated Cloud Function needed
// just to display them; get_user_rank exists for the admin dashboard to
// look up someone ELSE's rank instead. Rank itself IS now stored
// server-side (kept in sync by functions/main.py's _award_points) so it can
// be queried across users (see list_diamond_users) — see rank.js for why
// it's still recomputed here too rather than trusted blindly.
//
// Fetches points itself (rather than letting RankProgressCard below fetch
// it) because the milestone ladder here also needs it, for the
// current-rank highlighting — passing it down avoids two reads of the
// same doc.
function ProgressCard() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      const data = snap.exists() ? snap.data() : {};
      setProfile({ points: data.points || 0, certificateIssued: Boolean(data.certificateIssued) });
    });
  }, [user]);

  if (profile === null) return null;

  const { points, certificateIssued } = profile;
  const rank = rankForPoints(points);
  const rankOrder = allRanks();
  const currentIndex = rankOrder.indexOf(rank);

  return (
    <div className="flex flex-col gap-md">
      <RankProgressCard points={points} />
      <section className="ink-card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="rank-milestones">
          {rankOrder.map((name, i) => {
            const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'locked';
            const tone = name.toLowerCase();
            return (
              <div className="rank-milestone" key={name} data-state={state}>
                <span
                  className="rank-milestone-dot"
                  style={{ '--rank-color': `var(--rank-${tone})`, '--rank-ink': `var(--rank-${tone}-ink)` }}
                >
                  {state === 'done' && <IconCheck width={14} height={14} />}
                  {state === 'locked' && <IconLock width={14} height={12} />}
                </span>
                <span className="rank-milestone-label">{name}</span>
              </div>
            );
          })}
        </div>

        {certificateIssued && (
          <div className="rank-certificate-banner">
            <p style={{ margin: 0 }}>You&rsquo;ve been awarded a Diamond leadership certificate!</p>
            <Link to="/certificate">
              <StampButton type="button" variant="primary">View certificate</StampButton>
            </Link>
          </div>
        )}
      </section>
    </div>
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

// Lets a "user" change the accessibility needs and/or location they gave
// during onboarding — onboarding only ever sets these once, and needs (or
// where someone lives) can change afterward. Location doubles as the input
// to the accommodation-based side-quest-limit relaxation check (see
// rsvp_to_quest), so re-picking it here keeps that check current too, not
// just the display. Re-picking a place is optional — location fields are
// only sent to the server when the user actually changes them.
function AccommodationNeedsEditor() {
  const { user } = useAuth();
  const [needs, setNeeds] = useState(null);
  const [location, setLocation] = useState('');
  const [placeId, setPlaceId] = useState(null);
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);
  const [locationChanged, setLocationChanged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      const data = snap.exists() ? snap.data() : {};
      setNeeds(data.accommodationNeeds || []);
      setLocation(data.location || '');
      setPlaceId(data.placeId || null);
      setLat(typeof data.lat === 'number' ? data.lat : null);
      setLng(typeof data.lng === 'number' ? data.lng : null);
    });
  }, [user]);

  function toggle(value) {
    setSaved(false);
    setNeeds((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  async function save() {
    setError('');
    setSubmitting(true);
    try {
      const payload = { accommodationNeeds: needs };
      if (locationChanged) {
        payload.location = location;
        payload.placeId = placeId;
        payload.lat = lat;
        payload.lng = lng;
      }
      await callUpdateAccommodationNeeds(payload);
      setLocationChanged(false);
      setSaved(true);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (needs === null) return <LoadingSpinner label="Loading accessibility info..." />;

  return (
    <section className="ink-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ marginBottom: 0 }}>Accessibility &amp; Location</h2>
      <p style={{ margin: 0 }}>
        Missed this during onboarding, or does it need to change? Update it any time — it&rsquo;s
        what opens up side quests for you when accessible events nearby run out.
      </p>
      <div className="flex flex-wrap gap-sm">
        {ACCOMMODATION_OPTIONS.map((option) => (
          <TagStamp
            key={option.value}
            selectable
            selected={needs.includes(option.value)}
            onClick={() => toggle(option.value)}
          >
            {option.label}
          </TagStamp>
        ))}
      </div>
      <label>
        Your neighborhood or city
        <PlaceAutocompleteInput
          ariaLabel="Your neighborhood or city"
          placeholder="Search for a place..."
          onSelect={({ location: selectedLocation, placeId: selectedPlaceId, lat: selectedLat, lng: selectedLng }) => {
            setLocation(selectedLocation);
            setPlaceId(selectedPlaceId);
            setLat(selectedLat);
            setLng(selectedLng);
            setLocationChanged(true);
            setSaved(false);
          }}
        />
        {location && <p className="field-optional">{location}</p>}
      </label>
      {error && <p className="box-danger">{error}</p>}
      <StampButton type="button" variant="primary" onClick={save} disabled={submitting}>
        {submitting ? 'Saving...' : saved ? 'Saved!' : 'Save'}
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

const SOCIAL_LINK_FIELDS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'twitter', label: 'X / Twitter' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' },
];

// Everything an organization's public OrganizationProfile page shows
// beyond name/reason/location/phone/ltag/etag (all already editable
// elsewhere) — mission statement, city/state, website, a separate public
// contact email, a logo URL, and social links. Same view/edit-toggle shape
// as OrgTags above, just a longer form.
function OrgProfileEditor({ org, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState({
    logoUrl: org.logoUrl || '',
    category: org.category || '',
    missionStatement: org.missionStatement || '',
    city: org.city || '',
    state: org.state || '',
    website: org.website || '',
    contactEmail: org.contactEmail || '',
  });
  const [social, setSocial] = useState({ ...org.socialLinks });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function save(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, v.trim() || null]),
      );
      await callUpdateOrganizationProfile({ ...payload, socialLinks: social });
      onSaved({ ...payload, socialLinks: social });
      setEditing(false);
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing) {
    return (
      <section className="ink-card">
        <div className="section-heading">
          <h2 style={{ margin: 0 }}>Public Profile</h2>
          <StampButton type="button" onClick={() => setEditing(true)} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
            Edit
          </StampButton>
        </div>
        {!org.missionStatement && !org.website && !org.city ? (
          <p className="data-stat" style={{ margin: '10px 0 0' }}>Not set yet.</p>
        ) : (
          <div style={{ marginTop: 10 }}>
            {org.missionStatement && <p style={{ margin: 0 }}>{org.missionStatement}</p>}
            {(org.city || org.state) && (
              <p className="data-stat" style={{ marginTop: 8 }}>{[org.city, org.state].filter(Boolean).join(', ')}</p>
            )}
            {org.website && <p className="data-stat">{org.website}</p>}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="ink-card">
      <h2 style={{ marginTop: 0 }}>Public Profile</h2>
      <form onSubmit={save} className="flex flex-col gap-md">
        <label>
          Logo URL
          <input value={fields.logoUrl} onChange={(e) => setFields((f) => ({ ...f, logoUrl: e.target.value }))} placeholder="https://..." />
        </label>
        <label>
          Category
          <input value={fields.category} onChange={(e) => setFields((f) => ({ ...f, category: e.target.value }))} placeholder="Youth center, sports league, etc." />
        </label>
        <label>
          Mission statement
          <textarea value={fields.missionStatement} onChange={(e) => setFields((f) => ({ ...f, missionStatement: e.target.value }))} />
        </label>
        <label>
          City
          <input value={fields.city} onChange={(e) => setFields((f) => ({ ...f, city: e.target.value }))} />
        </label>
        <label>
          State
          <input value={fields.state} onChange={(e) => setFields((f) => ({ ...f, state: e.target.value }))} />
        </label>
        <label>
          Website
          <input value={fields.website} onChange={(e) => setFields((f) => ({ ...f, website: e.target.value }))} placeholder="https://..." />
        </label>
        <label>
          Public contact email (optional)
          <input value={fields.contactEmail} onChange={(e) => setFields((f) => ({ ...f, contactEmail: e.target.value }))} />
        </label>
        {SOCIAL_LINK_FIELDS.map(({ key, label }) => (
          <label key={key}>
            {label}
            <input
              value={social[key] || ''}
              onChange={(e) => setSocial((s) => ({ ...s, [key]: e.target.value }))}
              placeholder="https://..."
            />
          </label>
        ))}
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
        {role === 'user' && <AccommodationNeedsEditor />}

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
              <div className="flex items-center gap-sm">
                <h2 style={{ margin: 0 }}>About</h2>
                <TrustTag status={getTrustStatus(org.reviewCount || 0, org.avgRating || 0)} />
              </div>
              {getTrustStatus(org.reviewCount || 0, org.avgRating || 0) === 'under_review' && (
                <p className="box-danger" style={{ marginTop: 10 }}>
                  Your ratings have fallen low enough that your organization is under review. Improve your Trust
                  Score by delivering the experience your quests describe — an admin may also reach out.
                </p>
              )}
              <p style={{ margin: '10px 0 0' }}>{org.reason}</p>
              <p className="data-stat" style={{ marginTop: 10 }}>{org.location}</p>
              <p className="data-stat">{org.phone}</p>
            </section>
            <OrgTags org={org} onSaved={(t) => setOrg((prev) => ({ ...prev, ...t }))} />
            <OrgProfileEditor org={org} onSaved={(t) => setOrg((prev) => ({ ...prev, ...t }))} />
          </>
        )}
      </div>
    </PageMotion>
  );
}
