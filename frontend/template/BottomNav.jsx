import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { useAuth } from './AuthContext.jsx';
import { db } from './firebaseapp.jsx';
import { useIsDesktop } from './useIsDesktop.js';
import { useEarnedBadges } from './useEarnedBadges.js';
import { EditProfileModal } from './EditProfileModal.jsx';
import { BadgeRing } from '../mobile/Badges.jsx';
import {
  IconList,
  IconGrid,
  IconGear,
  IconPerson,
  IconTrophy,
  IconJournal,
  IconQrCode,
  IconPlus,
  IconMap,
  IconHome,
  IconLogout,
  IconEdit,
} from './icons.jsx';
import { Logo } from './Logo.jsx';
import { UserAvatar } from './UserAvatar.jsx';
import { OrgAvatar } from './OrgAvatar.jsx';

// Persistent navigation: a bottom tab bar on mobile, a horizontal topbar on
// desktop — same items, same component, just a different flex direction
// (see style.css). Each role's primary destination differs (a "user"
// browses Home first, then Quests; an "organization" gets its own Home
// then Your Quests, mirroring that same shape; an "admin" has both a feed
// and a data page) — this is deliberately role-aware rather than one
// generic list of icons, since forcing every role through the same tab set
// doesn't match how the app is actually routed.
//
// No separate "+ create" icon: for organization, quest creation lives
// inline on Your Quests (org/Quests.jsx) itself; for admin, on the Data
// page — so a second icon to an identical route would be a decorative
// duplicate rather than a real action. Profile is always present — every
// account needs a way to its own profile. Settings is reached from there
// (a gear icon on the Profile page itself) for `user` now instead of a nav
// slot — see settingsInFab below.
const PRIMARY_BY_ROLE = {
  user: [
    { to: '/', icon: IconHome, label: 'Home' },
    { to: '/quests', icon: IconList, label: 'Quests' },
  ],
  pending_org: [{ to: '/', icon: IconList, label: 'Quests' }],
  organization: [
    { to: '/org', icon: IconHome, label: 'Home' },
    { to: '/org/quests', icon: IconList, label: 'Quests' },
  ],
  admin: [
    { to: '/', icon: IconList, label: 'Quests' },
    { to: '/admin', icon: IconGrid, label: 'Data' },
  ],
};

// Extra feature destinations beyond a role's primary tab(s). For `user`
// this is now a flat, always-visible nav item (the redesigned wireframe's
// Home/Quests/Map/Journal/Profile bar has no FAB at all) — Check-in and
// Badges dropped out of this list entirely for `user`: Check-in is now a
// button on Home/Profile pointing straight at /check-in, and Badges is a
// preview section on Profile linking to /badges, so neither needs its own
// nav slot. `pending_org` keeps the older shape (shown as a normal nav pill
// on desktop, tucked behind the mobile "+" FAB) unchanged — that role isn't
// part of this redesign pass. Journal carries `badge: true` so its
// unread-feedback count (see useUnreadFeedbackCount below) surfaces
// wherever it renders. Map is the one feature every role gets — check-in/
// badges/journal are participant-only concepts, but "where is this
// happening" is useful to an organization checking its own pin or an admin
// browsing what's live, too.
const FEATURES_BY_ROLE = {
  user: [
    { to: '/map', icon: IconMap, label: 'Map' },
    { to: '/journal', icon: IconJournal, label: 'Journal', badge: true },
  ],
  pending_org: [
    { to: '/check-in', icon: IconQrCode, label: 'Check In' },
    { to: '/map', icon: IconMap, label: 'Map' },
    { to: '/badges', icon: IconTrophy, label: 'Badges' },
    { to: '/journal', icon: IconJournal, label: 'Journal', badge: true },
  ],
  // Map and the old host-reflection Journal (still at /org/journal, just no
  // longer linked from nav — see org/Journal.jsx) are dropped for this
  // redesign; Photo Submissions/Feedback Requests are the org's real daily
  // work, surfaced instead.
  organization: [
    { to: '/org/photo-submissions', icon: IconGrid, label: 'Photo' },
    { to: '/org/feedback-requests', icon: IconJournal, label: 'Feedback' },
  ],
  admin: [{ to: '/map', icon: IconMap, label: 'Map' }],
};

// Fans the FAB's popped-up circles out above it in a shallow arc (matching
// the reference sketch) rather than stacking them in a straight line —
// evenly spread across a fixed angle regardless of how many items end up in
// the list.
const FAB_RADIUS = 60;
const FAB_SPREAD_DEG = 80;
function fabCircleStyle(i, n) {
  const angle = n === 1 ? 0 : -FAB_SPREAD_DEG / 2 + (FAB_SPREAD_DEG * i) / (n - 1);
  const rad = (angle * Math.PI) / 180;
  const x = FAB_RADIUS * Math.sin(rad);
  const y = FAB_RADIUS * Math.cos(rad);
  return { left: `calc(50% + ${x}px)`, bottom: `calc(100% + ${y}px)` };
}

// Unread count for the Journal badge — a live listener (not a one-time
// fetch), so it updates the moment an organization answers a feedback
// request while the app is open, same as NotificationBanner's Home-screen
// notice for the same event. `read` is what this counts — a journal entry
// never has it set at all until a request completes (see
// check_in_to_event/submit_feedback_request_response), so this single-
// field query naturally never matches a quest with no feedback on it.
function useUnreadFeedbackCount(user, role) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user || (role !== 'user' && role !== 'pending_org')) {
      setCount(0);
      return undefined;
    }
    const q = query(collection(db, 'users', user.uid, 'journal'), where('read', '==', false));
    return onSnapshot(q, (snap) => setCount(snap.size));
  }, [user, role]);

  return count;
}

export function BottomNav() {
  const { role, user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [displayName, setDisplayName] = useState(null);
  const [photoURL, setPhotoURL] = useState(null);
  const [duckSkin, setDuckSkin] = useState(null);
  const [orgLogoUrl, setOrgLogoUrl] = useState(null);
  const [fabOpen, setFabOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  // Sticks true after the first open and never resets — lets the badges
  // fetch below run once per session (on first open) instead of never
  // re-triggering the effect on every subsequent open/close toggle.
  const [avatarMenuEverOpened, setAvatarMenuEverOpened] = useState(false);
  // Edit profile opens right here, wherever in the app the caller clicked
  // it from (see EditProfileModal.jsx) — no route change, so it no longer
  // routes through /profile first the way it briefly did.
  const [editingProfile, setEditingProfile] = useState(false);
  // Desktop sidebar collapse/expand — click-toggled via the brand logo
  // (see .bottom-nav-brand's onClick below), not hover; collapsed by
  // default so the rail starts icon-only.
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const unreadFeedback = useUnreadFeedbackCount(user, role);
  const reduce = useReducedMotion();
  // Gated behind the menu having been opened at least once — this nav
  // renders on every desktop page, so fetching quests/attendance/user-doc
  // (see useEarnedBadges) unconditionally would mean 3 extra Firestore
  // reads on every page load whether or not anyone ever opens the dropup.
  const earnedBadges = useEarnedBadges(
    role === 'user' && avatarMenuEverOpened ? user : null,
  );
  const recentBadges = (earnedBadges || [])
    .slice()
    .sort((a, b) => a.progress - a.target - (b.progress - b.target))
    .slice(0, 3);

  // A route change (including one triggered by picking a FAB or avatar menu
  // item) always closes both menus — BottomNav stays mounted across
  // navigations (see AppShell), so nothing else would close them otherwise.
  useEffect(() => {
    setFabOpen(false);
    setAvatarMenuOpen(false);
  }, [location.pathname]);

  // Only fetched for roles that render an avatar (desktop only) — an
  // organization's own name and logo (see OrgAvatar — same logoUrl field
  // its own OrganizationProfile.jsx page reads) from its org doc, a
  // member's own name and photo (for the image-or-duck avatar below — see
  // UserAvatar) from their user doc. Every other role never touches this.
  //
  // A live listener, not a one-time getDoc — this same edit is also
  // reachable from Profile.jsx/OrganizationProfile.jsx's own pages, which
  // keep their own separate copy of this same state (see those files'
  // own notes). BottomNav stays mounted across every navigation (see
  // AppShell), so a save made through one of those pages would otherwise
  // never reach this already-mounted nav's local state, leaving the small
  // avatar shown here stuck on the old photo/duck/name until a full
  // reload.
  useEffect(() => {
    if (!user) return;
    if (role === 'organization') {
      return onSnapshot(doc(db, 'organizations', user.uid), (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setDisplayName(data.name || '');
        setOrgLogoUrl(data.logoUrl || null);
      });
    }
    if (role === 'user' || role === 'pending_org') {
      return onSnapshot(doc(db, 'users', user.uid), (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setDisplayName(data.name || '');
        // Custom-uploaded photo wins over the Google account photo wins
        // over the chosen duck fallback — same priority as Profile.jsx.
        setPhotoURL(data.photoURL || user.photoURL || null);
        setDuckSkin(data.duckSkin || null);
      });
    }
    return undefined;
  }, [role, user]);

  // Profile's destination becomes a top-right avatar on desktop (matching
  // the wireframes for both the org and user views) instead of a pill
  // alongside the other nav items — mobile keeps the normal Profile tab for
  // every role, unchanged.
  const avatarOnDesktop =
    (role === 'organization' || role === 'user' || role === 'pending_org') && isDesktop;
  // Both the org and user views show their name next to the avatar once the
  // sidebar is a left rail with room for text (the org wireframe always had
  // this; the user view picked it up once the sidebar could expand).
  const showNameNextToAvatar = role === 'organization' || role === 'user';
  const features = FEATURES_BY_ROLE[role] || [];
  // `user` and `organization` both get the redesigned flat nav — no FAB at
  // all, features always shown as normal pills (mobile and desktop alike).
  // `pending_org`/`admin` keep the older shape: features tucked behind the
  // mobile "+" FAB, shown inline only on desktop.
  const flatNav = role === 'user' || role === 'organization';
  const showFeaturesInline = isDesktop || flatNav;
  // Settings joins Badges/Journal behind the mobile FAB for pending_org
  // specifically — every other role that still uses a FAB keeps Settings
  // as its own normal pill there. `user` no longer gets a Settings nav slot
  // on mobile at all: the gear icon on the Profile page (see Profile.jsx)
  // is the only way there now, matching the wireframe. On desktop, whichever
  // role gets the avatar also gets Settings folded into that avatar's
  // dropdown (alongside Profile) instead of a separate pill — see
  // avatarOnDesktop above.
  const settingsInFab = !isDesktop && role === 'pending_org';
  const fabMenuItems =
    !isDesktop && !flatNav
      ? [
          ...features,
          ...(settingsInFab ? [{ to: '/settings', icon: IconGear, label: 'Settings' }] : []),
        ]
      : [];
  const items = [
    ...(PRIMARY_BY_ROLE[role] || []),
    ...(showFeaturesInline ? features : []),
    ...(avatarOnDesktop ? [] : [{ to: '/profile', icon: IconPerson, label: 'Profile' }]),
    ...(settingsInFab || avatarOnDesktop || flatNav
      ? []
      : [{ to: '/settings', icon: IconGear, label: 'Settings' }]),
  ];

  return (
    // role="navigation" on a div, not a <nav> element — a fixed-position
    // <nav> renders ~16px short of the true viewport bottom in this
    // Chromium build (verified: identical styles on a <div> don't
    // reproduce it). The ARIA role gives screen readers the same landmark
    // without the engine quirk.
    <>
      {(fabOpen || avatarMenuOpen) && (
        <div
          className='fab-backdrop'
          onClick={() => {
            setFabOpen(false);
            setAvatarMenuOpen(false);
          }}
          aria-hidden='true'
        />
      )}
      <motion.div
        className='bottom-nav'
        role='navigation'
        aria-label='Primary'
        data-expanded={isDesktop ? sidebarExpanded : undefined}
      >
        <div className='bottom-nav-brand-row'>
          {isDesktop ? (
            // Desktop: the logo IS the sidebar toggle — no separate chevron
            // button, and it no longer routes home (that's what the Home
            // nav item below is for). A click toggle, not hover — stays
            // open/closed exactly as left rather than snapping shut the
            // instant the pointer wanders off.
            <button
              type='button'
              className='bottom-nav-brand'
              onClick={() => setSidebarExpanded((v) => !v)}
              aria-label={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
              title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <Logo size={24} />
            </button>
          ) : (
            <Link to='/' className='bottom-nav-brand' aria-hidden='true' tabIndex={-1}>
              <Logo size={24} />
            </Link>
          )}
        </div>
        {items.map((item, i) => {
          const Icon = item.icon;
          const current = location.pathname === item.to;
          const row = (
            <Link
              key={item.to}
              to={item.to}
              className='bottom-nav-item'
              aria-current={current ? 'page' : undefined}
              title={item.label}
            >
              {current && (
                <motion.span
                  layoutId='nav-active-pill'
                  className='bottom-nav-active-pill'
                  aria-hidden='true'
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <span className='bottom-nav-icon'>
                <Icon />
                {item.badge && unreadFeedback > 0 && (
                  <span className='nav-badge'>{unreadFeedback}</span>
                )}
              </span>
              <span>{item.label}</span>
            </Link>
          );
          // The FAB sits right after the primary tab(s), matching the
          // wireframe's Quests / + / Badges order — mobile only, and only
          // for roles with something to put behind it.
          if (i === (PRIMARY_BY_ROLE[role] || []).length - 1 && fabMenuItems.length > 0) {
            return (
              <div className='bottom-nav-fab-wrap' key='fab-wrap'>
                {row}
                <div className='bottom-nav-fab-slot'>
                  <button
                    type='button'
                    className='bottom-nav-fab'
                    aria-expanded={fabOpen}
                    aria-label={fabOpen ? 'Close menu' : 'More'}
                    onClick={() => setFabOpen((v) => !v)}
                  >
                    {fabOpen ? '×' : <IconPlus />}
                  </button>
                  {fabOpen &&
                    fabMenuItems.map((f, fi) => {
                      const FIcon = f.icon;
                      return (
                        <Link
                          key={f.to}
                          to={f.to}
                          className='bottom-nav-fab-circle'
                          role='menuitem'
                          title={f.label}
                          style={fabCircleStyle(fi, fabMenuItems.length)}
                        >
                          <FIcon />
                          {f.badge && unreadFeedback > 0 && (
                            <span className='nav-badge'>{unreadFeedback}</span>
                          )}
                          <span className='visually-hidden'>{f.label}</span>
                        </Link>
                      );
                    })}
                </div>
              </div>
            );
          }
          return row;
        })}
        {avatarOnDesktop && (
          <div className='bottom-nav-avatar-wrap'>
            {role === 'organization' ? (
              <>
                <button
                  type='button'
                  className='bottom-nav-avatar-link'
                  aria-haspopup='menu'
                  aria-expanded={avatarMenuOpen}
                  onClick={() => setAvatarMenuOpen((v) => !v)}
                >
                  {/* Avatar always first (left) — same order as the `user`
                      role's own button below; a name long enough to need
                      truncation reads oddly leading into a picture instead
                      of following it. */}
                  <div className='nav-avatar'>
                    <OrgAvatar name={displayName} seed={user.uid} logoUrl={orgLogoUrl} />
                  </div>
                  {showNameNextToAvatar && displayName && (
                    <span className='bottom-nav-org-name'>{displayName}</span>
                  )}
                </button>
                {avatarMenuOpen && (
                  <div className='bottom-nav-avatar-menu bottom-nav-avatar-menu-google' role='menu'>
                    {/* Same Google-account-menu header shape as the `user`
                        role's own dropdown below (logo, name, email) — an
                        org signs in through the same Firebase Auth account
                        as everyone else, so it has a real email to show
                        here too. */}
                    <div className='bottom-nav-avatar-menu-header'>
                      <div className='nav-avatar'>
                        <OrgAvatar name={displayName} seed={user.uid} logoUrl={orgLogoUrl} />
                      </div>
                      <div className='bottom-nav-avatar-menu-identity'>
                        <p className='bottom-nav-avatar-menu-name'>
                          <span className='bottom-nav-avatar-menu-name-text'>
                            {displayName || 'Your organization'}
                          </span>
                        </p>
                        <p className='bottom-nav-avatar-menu-email'>{user.email}</p>
                      </div>
                    </div>
                    <div className='bottom-nav-avatar-menu-divider' />
                    {/* Both route to the exact same org profile page and
                        URL — the only difference is this state flag (see
                        OrganizationProfile.jsx's own editMode), which is
                        the *only* way into edit mode there (no page-level
                        toggle). Without it ("View profile," or reaching
                        this same page any other way), the org sees the
                        identical read-only content a visitor does — no
                        pencils, no add/delete photo controls, nothing
                        owner-only. */}
                    <Link
                      to={`/organizations/${user.uid}`}
                      state={{ editMode: true }}
                      role='menuitem'
                      // Both links share the exact same pathname (see the
                      // note above) — a pathname-only aria-current check
                      // can't tell them apart, so whichever one matched on
                      // an *earlier* navigation just stayed lit regardless
                      // of which one was actually clicked most recently.
                      // location.state?.editMode (OrganizationProfile.jsx's
                      // own read of it) is the only thing that actually
                      // differs between them, so both checks below key off
                      // it instead, matching what the page itself is doing.
                      aria-current={
                        location.pathname === `/organizations/${user.uid}` && location.state?.editMode
                          ? 'page'
                          : undefined
                      }
                    >
                      <IconEdit /> Edit profile
                    </Link>
                    <Link
                      to={`/organizations/${user.uid}`}
                      role='menuitem'
                      aria-current={
                        location.pathname === `/organizations/${user.uid}` && !location.state?.editMode
                          ? 'page'
                          : undefined
                      }
                    >
                      <IconPerson /> View profile
                    </Link>
                    <Link
                      to='/settings'
                      role='menuitem'
                      aria-current={location.pathname === '/settings' ? 'page' : undefined}
                    >
                      <IconGear /> Settings
                    </Link>
                    <div className='bottom-nav-avatar-menu-divider' />
                    <button
                      type='button'
                      role='menuitem'
                      onClick={async () => {
                        await logout();
                        navigate('/login', { replace: true });
                      }}
                    >
                      <IconLogout /> Log out
                    </button>
                  </div>
                )}
              </>
            ) : role === 'user' ? (
              // Google-account-menu style: a header (bigger avatar + name/
              // badges/email) above Settings/Edit profile/Log out —
              // clicking the small nav avatar reveals who you are before
              // offering where to go, rather than jumping straight to a
              // page with no confirmation of which account.
              <>
                <button
                  type='button'
                  className='bottom-nav-avatar-link'
                  aria-haspopup='menu'
                  aria-expanded={avatarMenuOpen}
                  onClick={() => {
                    setAvatarMenuOpen((v) => !v);
                    setAvatarMenuEverOpened(true);
                  }}
                >
                  <UserAvatar photoURL={photoURL} duckSkin={duckSkin} className='nav-avatar nav-avatar-photo' />
                  {showNameNextToAvatar && displayName && (
                    <span className='bottom-nav-org-name'>{displayName}</span>
                  )}
                </button>
                {avatarMenuOpen && (
                  <div className='bottom-nav-avatar-menu bottom-nav-avatar-menu-google' role='menu'>
                    <div className='bottom-nav-avatar-menu-header'>
                      <UserAvatar
                        photoURL={photoURL}
                        duckSkin={duckSkin}
                        className='user-avatar bottom-nav-avatar-menu-photo'
                      />
                      <div className='bottom-nav-avatar-menu-identity'>
                        <p className='bottom-nav-avatar-menu-name'>
                          <span className='bottom-nav-avatar-menu-name-text'>
                            {displayName || 'Your profile'}
                          </span>
                          {recentBadges.length > 0 && (
                            <Link
                              to='/badges'
                              className='bottom-nav-avatar-menu-badges'
                              aria-label={`${recentBadges.length} recently earned badge${recentBadges.length === 1 ? '' : 's'} — view all badges`}
                            >
                              {recentBadges.map((b) => (
                                <BadgeRing key={b.id} badge={b} size={14} />
                              ))}
                            </Link>
                          )}
                        </p>
                        <p className='bottom-nav-avatar-menu-email'>{user.email}</p>
                      </div>
                    </div>
                    <div className='bottom-nav-avatar-menu-divider' />
                    <Link
                      to='/settings'
                      role='menuitem'
                      aria-current={location.pathname === '/settings' ? 'page' : undefined}
                    >
                      <IconGear /> Settings
                    </Link>
                    <button
                      type='button'
                      role='menuitem'
                      onClick={() => {
                        setAvatarMenuOpen(false);
                        setEditingProfile(true);
                      }}
                    >
                      <IconPerson /> Edit profile
                    </button>
                    <div className='bottom-nav-avatar-menu-divider' />
                    <button
                      type='button'
                      role='menuitem'
                      onClick={async () => {
                        await logout();
                        navigate('/login', { replace: true });
                      }}
                    >
                      <IconLogout /> Log out
                    </button>
                  </div>
                )}
                {editingProfile && (
                  <EditProfileModal
                    user={user}
                    currentName={displayName}
                    currentPhotoURL={photoURL}
                    currentDuckSkin={duckSkin}
                    onClose={() => setEditingProfile(false)}
                    onSaved={({ name: savedName, photoURL: savedPhotoURL, duckSkin: savedDuckSkin }) => {
                      setDisplayName(savedName);
                      setPhotoURL(savedPhotoURL);
                      setDuckSkin(savedDuckSkin);
                      setEditingProfile(false);
                    }}
                  />
                )}
              </>
            ) : (
              // pending_org keeps the older dropdown shape — this role
              // isn't part of this redesign pass (see the module note up
              // top on settingsInFab/flatNav).
              <>
                <button
                  type='button'
                  className='bottom-nav-avatar-link'
                  aria-haspopup='menu'
                  aria-expanded={avatarMenuOpen}
                  onClick={() => setAvatarMenuOpen((v) => !v)}
                >
                  <UserAvatar photoURL={photoURL} duckSkin={duckSkin} className='nav-avatar nav-avatar-photo' />
                </button>
                {avatarMenuOpen && (
                  <div className='bottom-nav-avatar-menu' role='menu'>
                    <Link
                      to='/profile'
                      role='menuitem'
                      aria-current={location.pathname === '/profile' ? 'page' : undefined}
                    >
                      <IconPerson /> Profile
                    </Link>
                    <Link
                      to='/settings'
                      role='menuitem'
                      aria-current={location.pathname === '/settings' ? 'page' : undefined}
                    >
                      <IconGear /> Settings
                    </Link>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </motion.div>
    </>
  );
}
