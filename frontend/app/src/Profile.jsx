import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
} from 'firebase/auth';
import { useAuth } from '@shared/AuthContext.jsx';
import { db, storage } from '@shared/firebaseapp.jsx';
import { callUpdateUserProfile } from '@shared/fetch.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { StatusStamp } from '@shared/StatusStamp.jsx';
import { LightboxBackdrop } from '@shared/LightboxBackdrop.jsx';
import { UserAvatar } from '@shared/UserAvatar.jsx';
import { IconChevron, IconGear, IconX } from '@shared/icons.jsx';
import { computeBadges } from '@shared/badges.js';
import { BadgeRing } from '@mobile/Badges.jsx';

// Every earned badge, computed once and shared by BadgesPreview below and
// Profile's own header (the last-3-earned icons next to the name) — one
// fetch instead of each duplicating it. null while loading.
function useEarnedBadges(user) {
  const [earned, setEarned] = useState(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([
      getDocs(collection(db, 'quests')),
      getDocs(query(collection(db, 'attendance'), where('userId', '==', user.uid))),
      getDoc(doc(db, 'users', user.uid)),
    ]).then(([questsSnap, attendanceSnap, userSnap]) => {
      if (cancelled) return;
      const questsById = new Map(questsSnap.docs.map((d) => [d.id, d.data()]));
      const attendance = attendanceSnap.docs.map((d) => d.data());
      const userData = userSnap.exists() ? userSnap.data() : {};
      const computed = computeBadges({
        attendance,
        questsById,
        rank: userData.rank,
        createdAt: userData.createdAt,
      });
      setEarned(computed.filter((b) => b.earned));
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return earned;
}

const PROFILE_PHOTO_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];
const PROFILE_PHOTO_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const PROFILE_PHOTO_EXT_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

// Name + profile picture live in Firestore (users/{uid}), so those two go
// through update_user_profile like everything else in this app ("every
// write goes through a Cloud Function"). Email and password are Firebase
// Auth's own concern instead — updateEmail/updatePassword talk to Auth
// directly, no Cloud Function involved — and only appear at all for an
// account that actually signed in with a password; a Google-only account
// has no password to change and Google, not this app, owns its email.
// Both require a fresh reauthentication first (Firebase's own
// "requires-recent-login" rule for anything security-sensitive), so
// "Current password" is asked for once and reused for whichever of the
// two actually changed.
function EditProfileModal({ user, currentName, currentPhotoURL, onClose, onSaved }) {
  const isPasswordProvider = user.providerData.some((p) => p.providerId === 'password');
  const [name, setName] = useState(currentName || '');
  const [file, setFile] = useState(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState(null);
  const [newEmail, setNewEmail] = useState(user.email || '');
  const [newPassword, setNewPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) {
      setLocalPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setLocalPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Give yourself a name.');
      return;
    }
    if (file) {
      if (!PROFILE_PHOTO_CONTENT_TYPES.includes(file.type)) {
        setError('Only JPEG, PNG, WebP, or HEIC photos are allowed.');
        return;
      }
      if (file.size > PROFILE_PHOTO_MAX_SIZE_BYTES) {
        setError('Photo must be smaller than 10MB.');
        return;
      }
    }
    const emailChanged = isPasswordProvider && newEmail.trim() !== user.email;
    const passwordChanged = isPasswordProvider && newPassword.trim().length > 0;
    if ((emailChanged || passwordChanged) && !currentPassword) {
      setError('Enter your current password to change your email or password.');
      return;
    }

    setSaving(true);
    try {
      if (emailChanged || passwordChanged) {
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);
        if (emailChanged) await updateEmail(user, newEmail.trim());
        if (passwordChanged) await updatePassword(user, newPassword.trim());
      }

      let photoURL;
      if (file) {
        const ext = PROFILE_PHOTO_EXT_BY_CONTENT_TYPE[file.type] || 'jpg';
        const path = `avatars/${user.uid}/${Date.now()}.${ext}`;
        await uploadBytes(storageRef(storage, path), file, { contentType: file.type });
        photoURL = await getDownloadURL(storageRef(storage, path));
      }

      const trimmedName = name.trim();
      if (trimmedName !== currentName || photoURL) {
        await callUpdateUserProfile({ name: trimmedName, ...(photoURL ? { photoURL } : {}) });
      }
      onSaved({ name: trimmedName, photoURL: photoURL || currentPhotoURL });
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <LightboxBackdrop onClose={onClose} label='Edit profile'>
      <div className='detail-modal-content' onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSave} className='ink-card flex flex-col gap-md'>
          <h3 style={{ margin: 0 }}>Edit Profile</h3>
          <label>
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Profile picture
            <input
              type='file'
              accept='image/jpeg,image/png,image/webp,image/heic,image/heif'
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          {(localPreviewUrl || currentPhotoURL) && (
            <img
              src={localPreviewUrl || currentPhotoURL}
              alt='Profile preview'
              style={{
                width: 72,
                height: 72,
                borderRadius: 'var(--radius-full)',
                objectFit: 'cover',
              }}
            />
          )}
          {isPasswordProvider && (
            <>
              <label>
                Email
                <input
                  type='email'
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </label>
              <label>
                New password <span className='field-optional'>(optional)</span>
                <input
                  type='password'
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder='Leave blank to keep your current password'
                />
              </label>
              <label>
                Current password
                <input
                  type='password'
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder='Only needed to change email or password'
                />
              </label>
            </>
          )}
          {error && <p className='box-danger'>{error}</p>}
          <div className='flex gap-sm'>
            <StampButton type='submit' variant='primary' disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </StampButton>
            <StampButton type='button' onClick={onClose} disabled={saving}>
              Cancel
            </StampButton>
          </div>
        </form>
        <button type='button' className='photo-lightbox-close' onClick={onClose} aria-label='Close'>
          <IconX width={18} height={18} />
        </button>
      </div>
    </LightboxBackdrop>
  );
}

// Wherever the caller stands in the organization-registration flow — the
// non-"user" counterpart to the rank card that used to live in this same
// sidebar/profile-grid slot (see @shared/ProgressCard.jsx — moved to
// Home.jsx instead). Its own component (rather than inline JSX) so both
// the mobile profile-grid and the desktop sidebar's bottom card can
// render the same markup instead of forking it.
function OrganizationCard({ role }) {
  return (
    <section className='ink-card' style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ marginBottom: 0 }}>Organization</h2>

      {role === 'onboarding_org' && (
        <div className='flex justify-between items-center'>
          <div>
            <StatusStamp muted>IN PROGRESS</StatusStamp>
            <p style={{ margin: '8px 0 0' }}>You started registering an organization.</p>
          </div>
          <Link to='/register/organization' aria-label='Finish your application'>
            <IconChevron style={{ transform: 'rotate(-90deg)' }} />
          </Link>
        </div>
      )}

      {role === 'pending_org' && (
        <div>
          <StatusStamp tone='outdoors'>UNDER REVIEW</StatusStamp>
          <p style={{ margin: '8px 0 0' }}>
            Your organization application is awaiting admin review.
          </p>
        </div>
      )}

      {role === 'organization' && (
        <div className='flex justify-between items-center'>
          <div>
            <StatusStamp tone='education'>APPROVED</StatusStamp>
            <p style={{ margin: '8px 0 0' }}>You already manage an organization.</p>
          </div>
          <Link to='/org' aria-label='Go to your organization home'>
            <IconChevron style={{ transform: 'rotate(-90deg)' }} />
          </Link>
        </div>
      )}

      {role === 'admin' && (
        <div>
          <StatusStamp tone='community'>FULL ACCESS</StatusStamp>
          <p style={{ margin: '8px 0 0' }}>
            You manage the whole platform from the <Link to='/admin'>admin data page</Link>.
          </p>
        </div>
      )}
    </section>
  );
}

// The "your account" hub: identity/badges, and wherever the caller stands
// in the organization-registration flow (role !== "user"). Rank progress
// used to live here too (a ProgressCard, role "user" only) — moved to
// Home.jsx instead, as the first thing a "user" lands on rather than
// tucked away here (see @shared/ProgressCard.jsx). Settings — interests/
// accessibility, display preferences, account deletion, signing out (see
// Settings.jsx) — briefly lived inline here too (a desktop-only two-column
// grid), but that's reverted: one identity card at every width again
// (photo/name/badges/email/Log out/Edit Profile), reached from a gear
// icon at its own top-right corner, same as before that grid existed and
// same as OrganizationProfile.jsx's own gear icon. Organizations now sign
// up directly from the landing page rather than converting from a regular
// user account, so there's no "become an organization" prompt here
// anymore — only the four states a caller already in that pipeline (or
// already an org/admin) can be in.
export function Profile() {
  const { user, role, loading, logout } = useAuth();
  const [name, setName] = useState(null);
  const [photoURL, setPhotoURL] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const earnedBadges = useEarnedBadges(role === 'user' ? user : null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      const data = snap.exists() ? snap.data() : {};
      setName(data.name || '');
      // A custom-uploaded photo (Firestore) wins over the Google account
      // photo (Firebase Auth) wins over the duck-mascot fallback (see
      // UserAvatar) — a password account has no Auth photoURL at all, so
      // it falls straight through to the duck.
      setPhotoURL(data.photoURL || user.photoURL || null);
    });
  }, [user]);

  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to='/login' replace />;

  // Most-recently-earned first — computeBadges has no real earnedAt
  // timestamp to sort by (see its own module note: badges are recomputed
  // from current progress, not logged as events), so this approximates
  // "recent" as "least overshot": a badge whose progress just barely
  // cleared its target was likely crossed more recently than one it's
  // long since blown past, assuming the underlying metric only climbs.
  // Good enough for a quick glance next to the name; the full Badges page
  // is still the source of truth for exact standing.
  const recentBadges = (earnedBadges || [])
    .slice()
    .sort((a, b) => a.progress - a.target - (b.progress - b.target))
    .slice(0, 3);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const nameAndBadges = (
    <h1 className='flex gap-sm' style={{ alignItems: 'baseline' }}>
      {name || 'Your profile'}
      {recentBadges.length > 0 && (
        <Link
          to='/badges'
          className='profile-name-badges'
          aria-label={`${recentBadges.length} recently earned badge${recentBadges.length === 1 ? '' : 's'} — view all badges`}
        >
          {recentBadges.map((b) => (
            <BadgeRing key={b.id} badge={b} size={16} />
          ))}
        </Link>
      )}
    </h1>
  );

  const editProfileModal = editingProfile && (
    <EditProfileModal
      user={user}
      currentName={name}
      currentPhotoURL={photoURL}
      onClose={() => setEditingProfile(false)}
      onSaved={({ name: savedName, photoURL: savedPhotoURL }) => {
        setName(savedName);
        setPhotoURL(savedPhotoURL);
        setEditingProfile(false);
      }}
    />
  );

  return (
    <PageMotion>
      <section className='ink-card profile-identity-card'>
        <Link
          to='/settings'
          className='profile-settings-link'
          aria-label='Settings'
          title='Settings'
        >
          <IconGear />
        </Link>
        <UserAvatar photoURL={photoURL} />
        {nameAndBadges}
        <p className='profile-meta'>{user.email}</p>
        <StampButton type='button' onClick={handleLogout}>
          Log out
        </StampButton>
        <StampButton type='button' onClick={() => setEditingProfile(true)}>
          Edit Profile
        </StampButton>
      </section>

      {editProfileModal}

      <div className='profile-grid'>
        {role !== 'user' && <OrganizationCard role={role} />}
      </div>
    </PageMotion>
  );
}
