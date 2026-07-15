import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from './AuthContext.jsx';
import { db } from './firebaseapp.jsx';
import { useIsDesktop } from './useIsDesktop.js';
import { IconList, IconGrid, IconGear, IconPerson, IconTrophy, IconPlus } from './icons.jsx';
import { Logo } from './Logo.jsx';
import { getInitials } from './initials.js';

// Persistent navigation: a bottom tab bar on mobile, a horizontal topbar on
// desktop — same items, same component, just a different flex direction
// (see style.css). Each role's primary destination differs (a "user"
// browses the quest feed; an "organization" manages its own dashboard; an
// "admin" has both a feed and a data page) — this is deliberately
// role-aware rather than one generic list of icons, since forcing every
// role through the same tab set doesn't match how the app is actually
// routed.
//
// No separate "+ create" icon: for organization/admin, quest creation
// already lives inline on the same dashboard page their primary icon
// points to, so a second icon to the identical route would be a decorative
// duplicate rather than a real action. Profile/Settings are both always
// present — every account, regardless of role, needs a way to its own
// profile and to display settings/account deletion.
const PRIMARY_BY_ROLE = {
  user: [{ to: '/', icon: IconList, label: 'Quests' }],
  pending_org: [{ to: '/', icon: IconList, label: 'Quests' }],
  organization: [{ to: '/org', icon: IconList, label: 'Dashboard' }],
  admin: [
    { to: '/', icon: IconList, label: 'Quests' },
    { to: '/admin', icon: IconGrid, label: 'Data' },
  ],
};

// Extra feature destinations beyond a role's primary tab — shown as a
// normal nav pill on desktop (matching the wireframe's horizontal nav), but
// tucked behind the mobile "+" FAB instead of crowding the tab bar (matching
// the wireframe's Quests/+/Badges bottom nav). Badges is the only entry
// today; a Journal entry is planned to join this same list later — nothing
// else about the FAB needs to change to add it.
const FEATURES_BY_ROLE = {
  user: [{ to: '/badges', icon: IconTrophy, label: 'Badges' }],
  pending_org: [{ to: '/badges', icon: IconTrophy, label: 'Badges' }],
};

// Fans the FAB's popped-up circles out above it in a shallow arc (matching
// the reference sketch) rather than stacking them in a straight line —
// evenly spread across a fixed angle regardless of how many items end up in
// the list, so adding a third (Journal) later needs no layout changes.
const FAB_RADIUS = 60;
const FAB_SPREAD_DEG = 80;
function fabCircleStyle(i, n) {
  const angle = n === 1 ? 0 : -FAB_SPREAD_DEG / 2 + (FAB_SPREAD_DEG * i) / (n - 1);
  const rad = (angle * Math.PI) / 180;
  const x = FAB_RADIUS * Math.sin(rad);
  const y = FAB_RADIUS * Math.cos(rad);
  return { left: `calc(50% + ${x}px)`, bottom: `calc(100% + ${y}px)` };
}

export function BottomNav() {
  const { role, user } = useAuth();
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const [displayName, setDisplayName] = useState(null);
  const [fabOpen, setFabOpen] = useState(false);

  // A route change (including one triggered by picking a FAB menu item)
  // always closes the menu — BottomNav stays mounted across navigations
  // (see AppShell), so nothing else would close it otherwise.
  useEffect(() => {
    setFabOpen(false);
  }, [location.pathname]);

  // Only fetched for roles that render an avatar (desktop only) — an
  // organization's own name from its org doc, a member's own name from
  // their user doc. Every other role never touches this.
  useEffect(() => {
    if (!user) return;
    if (role === 'organization') {
      getDoc(doc(db, 'organizations', user.uid)).then((snap) => {
        if (snap.exists()) setDisplayName(snap.data().name || '');
      });
    } else if (role === 'user' || role === 'pending_org') {
      getDoc(doc(db, 'users', user.uid)).then((snap) => {
        if (snap.exists()) setDisplayName(snap.data().name || '');
      });
    }
  }, [role, user]);

  // Profile's destination becomes a top-right avatar on desktop (matching
  // the wireframes for both the org and user views) instead of a pill
  // alongside the other nav items — mobile keeps the normal Profile tab for
  // every role, unchanged.
  const avatarOnDesktop = (role === 'organization' || role === 'user' || role === 'pending_org') && isDesktop;
  // Only the org view shows its name in text next to the avatar (matching
  // that wireframe); the user view's avatar stands alone.
  const showNameNextToAvatar = role === 'organization';
  const features = FEATURES_BY_ROLE[role] || [];
  // Settings joins Badges behind the mobile FAB for the user view specifically
  // (matching the reference sketch: Quests stays left, Profile stays right,
  // everything else tucks behind the +) — every other role, and the user
  // view itself on desktop, keeps Settings as its own normal pill.
  const settingsInFab = !isDesktop && (role === 'user' || role === 'pending_org');
  const fabMenuItems = !isDesktop
    ? [...features, ...(settingsInFab ? [{ to: '/settings', icon: IconGear, label: 'Settings' }] : [])]
    : [];
  const items = [
    ...(PRIMARY_BY_ROLE[role] || []),
    ...(isDesktop ? features : []),
    ...(avatarOnDesktop ? [] : [{ to: '/profile', icon: IconPerson, label: 'Profile' }]),
    ...(settingsInFab ? [] : [{ to: '/settings', icon: IconGear, label: 'Settings' }]),
  ];

  return (
    // role="navigation" on a div, not a <nav> element — a fixed-position
    // <nav> renders ~16px short of the true viewport bottom in this
    // Chromium build (verified: identical styles on a <div> don't
    // reproduce it). The ARIA role gives screen readers the same landmark
    // without the engine quirk.
    <>
      {fabOpen && <div className="fab-backdrop" onClick={() => setFabOpen(false)} aria-hidden="true" />}
      <div className="bottom-nav" role="navigation" aria-label="Primary">
        <Link to="/" className="bottom-nav-brand" aria-hidden="true" tabIndex={-1}>
          <Logo size={24} />
        </Link>
        {items.map((item, i) => {
          const Icon = item.icon;
          const current = location.pathname === item.to;
          const row = (
            <Link
              key={item.to}
              to={item.to}
              className="bottom-nav-item"
              aria-current={current ? 'page' : undefined}
              title={item.label}
            >
              <Icon />
              <span>{item.label}</span>
            </Link>
          );
          // The FAB sits right after the primary tab(s), matching the
          // wireframe's Quests / + / Badges order — mobile only, and only
          // for roles with something to put behind it.
          if (i === (PRIMARY_BY_ROLE[role] || []).length - 1 && fabMenuItems.length > 0) {
            return (
              <div className="bottom-nav-fab-wrap" key="fab-wrap">
                {row}
                <div className="bottom-nav-fab-slot">
                  <button
                    type="button"
                    className="bottom-nav-fab"
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
                          className="bottom-nav-fab-circle"
                          role="menuitem"
                          title={f.label}
                          style={fabCircleStyle(fi, fabMenuItems.length)}
                        >
                          <FIcon />
                          <span className="visually-hidden">{f.label}</span>
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
          <Link
            to="/profile"
            className="bottom-nav-avatar-link"
            aria-current={location.pathname === '/profile' ? 'page' : undefined}
            title="Profile"
          >
            {showNameNextToAvatar && displayName && <span className="bottom-nav-org-name">{displayName}</span>}
            <span className="nav-avatar">{getInitials(displayName)}</span>
          </Link>
        )}
      </div>
    </>
  );
}
