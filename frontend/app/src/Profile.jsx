import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '@shared/AuthContext.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { StatusStamp } from '@shared/StatusStamp.jsx';
import { UserAvatar } from '@shared/UserAvatar.jsx';
import { IconChevron } from '@shared/icons.jsx';
import { useEarnedBadges } from '@shared/useEarnedBadges.js';
import { EditProfileModal } from '@shared/EditProfileModal.jsx';
import { BadgeRing } from '@mobile/Badges.jsx';

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
  const [duckSkin, setDuckSkin] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const earnedBadges = useEarnedBadges(role === 'user' ? user : null);
  const navigate = useNavigate();

  // A live listener, not a one-time getDoc — BottomNav's avatar dropdown
  // opens the exact same EditProfileModal as an overlay on top of whichever
  // page is already showing, Profile included, without navigating away.
  // A save from that path only ever updated BottomNav's own local state
  // (see BottomNav.jsx), never this already-mounted page's — a one-time
  // fetch would keep showing the old photo/duck until the next remount.
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const data = snap.exists() ? snap.data() : {};
      setName(data.name || '');
      // A custom-uploaded photo (Firestore) wins over the Google account
      // photo (Firebase Auth) wins over the chosen duck fallback (see
      // UserAvatar) — a password account has no Auth photoURL at all, so
      // it falls straight through to the duck.
      setPhotoURL(data.photoURL || user.photoURL || null);
      setDuckSkin(data.duckSkin || null);
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
      currentDuckSkin={duckSkin}
      onClose={() => setEditingProfile(false)}
      onSaved={({ name: savedName, photoURL: savedPhotoURL, duckSkin: savedDuckSkin }) => {
        setName(savedName);
        setPhotoURL(savedPhotoURL);
        setDuckSkin(savedDuckSkin);
        setEditingProfile(false);
      }}
    />
  );

  return (
    <PageMotion>
      <section className='ink-card profile-identity-card'>
        <UserAvatar photoURL={photoURL} duckSkin={duckSkin} />
        {nameAndBadges}
        <p className='profile-meta'>{user.email}</p>
        <StampButton type='button' variant='primary' onClick={() => setEditingProfile(true)}>
          Edit Profile
        </StampButton>
        <StampButton as={Link} to='/settings'>
          Settings
        </StampButton>
        <div className='profile-identity-divider' />
        <StampButton type='button' onClick={handleLogout}>
          Log out
        </StampButton>
      </section>

      {editProfileModal}

      <div className='profile-grid'>
        {role !== 'user' && <OrganizationCard role={role} />}
      </div>
    </PageMotion>
  );
}
