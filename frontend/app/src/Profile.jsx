import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { EmailAuthProvider, reauthenticateWithCredential, updateEmail, updatePassword } from 'firebase/auth';
import { useAuth } from '@shared/AuthContext.jsx';
import { db, storage } from '@shared/firebaseapp.jsx';
import { callUpdateUserProfile } from '@shared/fetch.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { StatusStamp } from '@shared/StatusStamp.jsx';
import { LightboxBackdrop } from '@shared/LightboxBackdrop.jsx';
import { UserAvatar } from '@shared/UserAvatar.jsx';
import { groupBySeries, isUpcoming } from '@shared/questSeries.js';
import { IconCheck, IconChevron, IconLock, IconGear, IconX } from '@shared/icons.jsx';
import { allRanks, pointsToNextRank, progressPercent, rankForPoints } from '@shared/rank.js';
import { computeBadges } from '@shared/badges.js';
import { BadgeRing } from '@mobile/Badges.jsx';

// Points/rank/certificateIssued are read straight off the user's own doc
// (self-readable, see firestore.rules) — no dedicated Cloud Function needed
// just to display them; get_user_rank exists for the admin dashboard to
// look up someone ELSE's rank instead. Rank itself IS now stored
// server-side (kept in sync by functions/main.py's _award_points) so it can
// be queried across users (see list_diamond_users) — see rank.js for why
// it's still recomputed here too rather than trusted blindly.
// Always fully shown, not collapsed behind a tap — Profile is exactly the
// place someone comes to check "where am I," so the milestone ladder (and
// the certificate banner, once earned) is part of the first glance rather
// than something an expand toggle hid.
function ProgressCard() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const reduce = useReducedMotion();

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
  const toNext = pointsToNextRank(points);
  const percent = progressPercent(points);
  const rankOrder = allRanks();
  const currentIndex = rankOrder.indexOf(rank);

  return (
    // Mounts once this card's own fetch resolves — well after Profile's own
    // PageMotion shell has already finished animating in — so without its
    // own transition here, rank/points/milestones would just snap into
    // view with no arrival of their own.
    <motion.section
      className="ink-card"
      style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
      initial={reduce ? false : { opacity: 0, y: 8, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
    >
      <div className="quest-card-titles">
        <h2 style={{ marginBottom: 0 }}>Leadership Rank</h2>
        <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.4rem', textTransform: 'uppercase' }}>
          {rank}
        </p>
      </div>

      <p className="data-stat" style={{ marginTop: 4 }}>
        {points} point{points === 1 ? '' : 's'}
        {toNext !== null ? ` — ${toNext} to ${rankForPoints(points + toNext)}` : ' — top rank reached'}
      </p>

      <div className="rank-progress-track" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
        <div className="rank-progress-fill" style={{ width: `${percent}%` }} />
      </div>

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
    </motion.section>
  );
}

// A quick glimpse of quests the caller is RSVP'd to — the full list (with
// cancel/manage actions) still lives on Quests itself; tapping through here
// just pre-filters that page via ?mine=1 (see Quests.jsx's `mineOnly`)
// rather than duplicating any of that UI on Profile.
function RsvpdQuestsPreview() {
  const { user } = useAuth();
  const [series, setSeries] = useState(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getDocs(query(collection(db, 'quests'), where('rsvpd', 'array-contains', user.uid))).then((snap) => {
      if (cancelled) return;
      const quests = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(isUpcoming);
      setSeries(groupBySeries(quests));
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (series === null) return null;

  return (
    <motion.section
      className="ink-card"
      initial={reduce ? false : { opacity: 0, y: 8, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
    >
      <div className="flex justify-between items-center">
        <div>
          <h2 style={{ margin: 0 }}>RSVP&rsquo;d Quests</h2>
          <p className="data-stat" style={{ marginTop: 4 }}>
            {series.length === 0 ? 'Nothing on your calendar yet' : `${series.length} upcoming`}
          </p>
        </div>
        <Link to="/quests?mine=1" aria-label="View all RSVP'd quests">
          <IconChevron style={{ transform: 'rotate(-90deg)' }} />
        </Link>
      </div>
      {series.length > 0 && (
        <ul className="data-sublist" style={{ marginTop: 10 }}>
          {series.slice(0, 3).map((s) => (
            <li key={s.seriesId}>{s.primary.title}</li>
          ))}
        </ul>
      )}
    </motion.section>
  );
}

// A quick glimpse of earned badges — the full grid (with in-progress/
// undiscovered sections) lives on the existing Badges page (see
// mobile/Badges.jsx, which now exports BadgeRing for this reuse); tapping
// through here goes straight there rather than re-implementing that page.
function BadgesPreview() {
  const { user } = useAuth();
  const [earned, setEarned] = useState(null);
  const reduce = useReducedMotion();

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
      const computed = computeBadges({ attendance, questsById, rank: userData.rank, createdAt: userData.createdAt });
      setEarned(computed.filter((b) => b.earned));
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (earned === null) return null;

  return (
    <motion.section
      className="ink-card"
      initial={reduce ? false : { opacity: 0, y: 8, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
    >
      <div className="flex justify-between items-center">
        <div>
          <h2 style={{ margin: 0 }}>All Badges</h2>
          <p className="data-stat" style={{ marginTop: 4 }}>
            {earned.length === 0 ? 'None yet — that’s next' : `${earned.length} earned`}
          </p>
        </div>
        <Link to="/badges" aria-label="View all badges">
          <IconChevron style={{ transform: 'rotate(-90deg)' }} />
        </Link>
      </div>
      {earned.length > 0 && (
        <div className="profile-preview-badges" style={{ marginTop: 10 }}>
          {earned.slice(0, 6).map((b) => (
            <BadgeRing key={b.id} badge={b} size={56} />
          ))}
        </div>
      )}
    </motion.section>
  );
}

const PROFILE_PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
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
      setError(err.message || "That didn't go through — try again in a moment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <LightboxBackdrop onClose={onClose} label="Edit profile">
      <div className="detail-modal-content" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSave} className="ink-card flex flex-col gap-md">
          <h3 style={{ margin: 0 }}>Edit Profile</h3>
          <label>
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Profile picture
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          {(localPreviewUrl || currentPhotoURL) && (
            <img
              src={localPreviewUrl || currentPhotoURL}
              alt="Profile preview"
              style={{ width: 72, height: 72, borderRadius: 'var(--radius-full)', objectFit: 'cover' }}
            />
          )}
          {isPasswordProvider && (
            <>
              <label>
                Email
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              </label>
              <label>
                New password <span className="field-optional">(optional)</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Leave blank to keep your current password"
                />
              </label>
              <label>
                Current password
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Only needed to change email or password"
                />
              </label>
            </>
          )}
          {error && <p className="box-danger">{error}</p>}
          <div className="flex gap-sm">
            <StampButton type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </StampButton>
            <StampButton type="button" onClick={onClose} disabled={saving}>
              Cancel
            </StampButton>
          </div>
        </form>
        <button type="button" className="photo-lightbox-close" onClick={onClose} aria-label="Close">
          <IconX width={18} height={18} />
        </button>
      </div>
    </LightboxBackdrop>
  );
}

// The "your account" hub: identity, rank progress/RSVPs/badges (role "user"
// only), and wherever the caller stands in the organization-registration
// flow. Settings, by contrast, is interests/accessibility, display
// preferences, account deletion, and now signing out too (see
// Settings.jsx) — this split keeps "things about me" (who I am, what I've
// done) separate from "things I'd tweak," reached from here via the gear
// icon. Organizations now sign up directly from the landing page rather
// than converting from a regular user account, so there's no "become an
// organization" prompt here anymore — only the four states a caller
// already in that pipeline (or already an org/admin) can be in.
export function Profile() {
  const { user, role, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(null);
  const [photoURL, setPhotoURL] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);

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
  if (!user) return <Navigate to="/login" replace />;

  // Same action as Settings' own LogoutSection — reachable from here too
  // (Profile is one tap away from the bottom nav; Settings is a second tap
  // from the gear icon plus a scroll past Theme/Interests/Accommodation).
  // Kept deliberately quiet — plain text, no border — so it doesn't compete
  // with Edit Profile/Scan QR Code above for attention.
  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <PageMotion>
      <div className="profile-identity">
        <UserAvatar photoURL={photoURL} />
        <div className="profile-identity-info">
          <h1>{name || 'Your profile'}</h1>
          <p className="profile-meta">Signed in as {user.email}</p>
        </div>
        <Link to="/settings" className="profile-settings-link" aria-label="Settings" title="Settings">
          <IconGear />
        </Link>
      </div>

      {role === 'user' && (
        <div className="flex gap-sm" style={{ marginBottom: 16 }}>
          <StampButton type="button" style={{ flex: 1 }} onClick={() => setEditingProfile(true)}>
            Edit Profile
          </StampButton>
          <Link to="/check-in" style={{ flex: 1 }}>
            <StampButton type="button" style={{ width: '100%' }}>
              Scan QR Code
            </StampButton>
          </Link>
        </div>
      )}

      {editingProfile && (
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
      )}

      <div className="profile-grid">
        {role === 'user' && <ProgressCard />}
        {role === 'user' && <RsvpdQuestsPreview />}
        {role === 'user' && <BadgesPreview />}

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
                <Link to="/org" aria-label="Go to your organization home">
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
      </div>

      <div style={{ textAlign: 'center', marginTop: 24 }}>
        <StampButton
          type="button"
          onClick={handleLogout}
          style={{ border: 'none', background: 'none', boxShadow: 'none', color: 'var(--line-soft)' }}
        >
          Log out
        </StampButton>
      </div>
    </PageMotion>
  );
}
