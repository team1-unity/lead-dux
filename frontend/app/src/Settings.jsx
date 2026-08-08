import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { doc, getDoc } from 'firebase/firestore';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
} from 'firebase/auth';
import { useAuth } from '@shared/AuthContext.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { callDeleteAccount, callUpdateAccommodationNeeds } from '@shared/fetch.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';
import { TopBar } from '@shared/TopBar.jsx';
import { BackLink } from '@shared/BackLink.jsx';
import { usePreviousPath } from '@shared/PreviousPathContext.jsx';
import { labelForPath } from '@shared/routeLabels.js';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { TagStamp } from '@shared/TagStamp.jsx';
import { PlaceAutocompleteInput } from '@shared/PlaceAutocompleteInput.jsx';
import { ACCOMMODATION_OPTIONS } from '@shared/accommodations.js';
import { getStoredTheme, applyTheme } from '@shared/theme.js';

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function ThemePicker() {
  const [theme, setTheme] = useState(getStoredTheme());

  function choose(value) {
    applyTheme(value);
    setTheme(value);
  }

  return (
    <section className="ink-card">
      <h2>Display</h2>
      <p style={{ marginTop: 0 }}>Choose how Lead-Dux looks on this device.</p>
      <div className="theme-option-row">
        {THEME_OPTIONS.map((opt) => (
          <StampButton
            key={opt.value}
            type="button"
            className="theme-option"
            data-active={theme === opt.value}
            onClick={() => choose(opt.value)}
          >
            {opt.label}
          </StampButton>
        ))}
      </div>
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
export function AccommodationNeedsEditor() {
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

  if (needs === null) return <LoadingSpinner label="Loading accessibility info…" />;

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
          placeholder="Search for a place…"
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
        {submitting ? 'Saving…' : saved ? 'Saved!' : 'Save'}
      </StampButton>
    </section>
  );
}

// Email/password change — moved here from EditProfileModal (which used to
// hold this alongside name/photo/duck): those are visual identity, this is
// account security, and the two don't really belong in the same "Edit
// Profile" popup. Firebase Auth's own concern, not Firestore — updateEmail/
// updatePassword talk to Auth directly, no Cloud Function involved — and
// only rendered at all for an account that actually signed in with a
// password; a Google-only account has no password to change and Google,
// not this app, owns its email. Both require a fresh reauthentication
// first (Firebase's own "requires-recent-login" rule for anything
// security-sensitive), so "Current password" is asked for once and reused
// for whichever of the two actually changed.
function AccountSection() {
  const { user } = useAuth();
  const isPasswordProvider = user.providerData.some((p) => p.providerId === 'password');
  const [newEmail, setNewEmail] = useState(user.email || '');
  const [newPassword, setNewPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  if (!isPasswordProvider) return null;

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSaved(false);
    const emailChanged = newEmail.trim() !== user.email;
    const passwordChanged = newPassword.trim().length > 0;
    if (!emailChanged && !passwordChanged) {
      setError('Change your email or enter a new password first.');
      return;
    }
    if (!currentPassword) {
      setError('Enter your current password to make this change.');
      return;
    }
    setSaving(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      if (emailChanged) await updateEmail(user, newEmail.trim());
      if (passwordChanged) await updatePassword(user, newPassword.trim());
      setNewPassword('');
      setCurrentPassword('');
      setSaved(true);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="ink-card">
      <h2>Account</h2>
      <form onSubmit={handleSave} className="flex flex-col gap-md">
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={newEmail}
            onChange={(e) => {
              setNewEmail(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        <label>
          New password <span className="field-optional">(optional)</span>
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setSaved(false);
            }}
            placeholder="Leave blank to keep your current password"
          />
        </label>
        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Required to change email or password"
          />
        </label>
        {error && <p className="box-danger">{error}</p>}
        <StampButton type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
        </StampButton>
      </form>
    </section>
  );
}

// Settings is "how the app looks/whether I keep my account," so signing
// out used to live only here — a "user" role's own Profile.jsx identity
// card now has its own quick "Log out" button directly on it, so this
// section is skipped for that role (see Settings() below) to avoid
// offering the exact same action twice; other roles (organization/admin/
// pending_org/onboarding_org) still reach it here, same as before.
export function LogoutSection() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <section className="ink-card">
      <h2>Account</h2>
      <StampButton type="button" onClick={handleLogout}>
        Log out
      </StampButton>
    </section>
  );
}

// Deleting an account is destructive and permanent, so it's gated behind a
// typed confirmation rather than a single click or a plain window.confirm
// — the cascade wording below tells the caller exactly what they're about
// to lose before they can even reach the confirm button.
export function DangerZone() {
  const { role, logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const cascadeCopy =
    role === 'organization'
      ? 'This permanently deletes your organization profile and every quest you posted.'
      : "This removes you from every quest you've RSVP'd to.";

  async function deleteAccount() {
    setSubmitting(true);
    setError('');
    try {
      await callDeleteAccount();
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(getAuthErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <section className="ink-card" data-danger="true">
      <h2>Danger zone</h2>
      {!confirming ? (
        <StampButton type="button" variant="danger" onClick={() => setConfirming(true)}>
          Delete account
        </StampButton>
      ) : (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          transition={{ duration: 0.2 }}
          style={{ overflow: 'hidden' }}
        >
          <div className="flex flex-col gap-md" style={{ paddingTop: 4 }}>
            <p style={{ margin: 0 }}>{cascadeCopy} This cannot be undone.</p>
            <label>
              Type DELETE to confirm
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
            </label>
            {error && <p className="box-danger">{error}</p>}
            <div className="flex gap-sm">
              <StampButton
                type="button"
                variant="danger"
                disabled={confirmText !== 'DELETE' || submitting}
                onClick={deleteAccount}
              >
                {submitting ? 'Deleting…' : 'Permanently delete'}
              </StampButton>
              <StampButton
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setConfirmText('');
                  setError('');
                }}
                disabled={submitting}
              >
                Cancel
              </StampButton>
            </div>
          </div>
        </motion.div>
      )}
    </section>
  );
}

// App preferences — a "user" role's accessibility needs (see
// AccommodationNeedsEditor above; interests has no editor here anymore,
// see functions/main.py's module note above _generate_quest_recommendations
// for why), account security (email/password, see AccountSection — every
// role with a password provider gets this, not just "user"), signing out
// (for every role except "user" — see LogoutSection's own comment), and
// the one destructive account action. Identity and organization status
// still live on Profile instead (see Profile.jsx). Not wrapped in
// narrow-content: at desktop width each section spans the full
// dashboard-style width rather than floating a mobile-width form in the
// middle of a wide page.
export function Settings() {
  const { user, role, loading } = useAuth();
  const previousPath = usePreviousPath();

  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  // Settings is reachable from almost anywhere (the nav's avatar dropdown
  // works on every page), so "back" means wherever the caller actually
  // came from, not a single fixed parent — falls back to Profile (an
  // organization's own public profile page, not the generic member
  // Profile.jsx — see OrganizationProfile.jsx) when there's no previous
  // in-app page to reflect, e.g. a direct link or a page refresh.
  const previousLabel = labelForPath(previousPath);
  const backTo = previousLabel
    ? previousPath
    : role === 'organization'
      ? `/organizations/${user.uid}`
      : '/profile';
  const backLabel = previousLabel || 'Profile';

  return (
    <PageMotion>
      <BackLink to={backTo} label={backLabel} />
      <TopBar title="Settings" />
      <div className="settings-grid">
        <ThemePicker />
        {role === 'user' && <AccommodationNeedsEditor />}
        <AccountSection />
        {role !== 'user' && <LogoutSection />}
        <DangerZone />
      </div>
    </PageMotion>
  );
}
