import { Link, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { IconList, IconGrid, IconGear, IconPerson } from './icons.jsx';
import { Logo } from './Logo.jsx';

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

export function BottomNav() {
  const { role } = useAuth();
  const location = useLocation();
  const items = [
    ...(PRIMARY_BY_ROLE[role] || []),
    { to: '/profile', icon: IconPerson, label: 'Profile' },
    { to: '/settings', icon: IconGear, label: 'Settings' },
  ];

  return (
    // role="navigation" on a div, not a <nav> element — a fixed-position
    // <nav> renders ~16px short of the true viewport bottom in this
    // Chromium build (verified: identical styles on a <div> don't
    // reproduce it). The ARIA role gives screen readers the same landmark
    // without the engine quirk.
    <div className="bottom-nav" role="navigation" aria-label="Primary">
      <Link to="/" className="bottom-nav-brand" aria-hidden="true" tabIndex={-1}>
        <Logo size={24} />
      </Link>
      {items.map((item) => {
        const Icon = item.icon;
        const current = location.pathname === item.to;
        return (
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
      })}
    </div>
  );
}
