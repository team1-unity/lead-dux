import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useAuth } from './AuthContext.jsx';
import { db } from './firebaseapp.jsx';
import { IconList, IconGrid, IconGear, IconPerson, IconJournal } from './icons.jsx';

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
  user: [
    { to: '/', icon: IconList, label: 'Quests' },
    { to: '/journal', icon: IconJournal, label: 'Journal', badge: true },
  ],
  pending_org: [
    { to: '/', icon: IconList, label: 'Quests' },
    { to: '/journal', icon: IconJournal, label: 'Journal', badge: true },
  ],
  organization: [
    { to: '/org', icon: IconList, label: 'Dashboard' },
    { to: '/org/journal', icon: IconJournal, label: 'Journal' },
  ],
  admin: [
    { to: '/', icon: IconList, label: 'Quests' },
    { to: '/admin', icon: IconGrid, label: 'Data' },
  ],
};

// Unread count for the Journal badge — a live listener (not a one-time
// fetch), so it updates the moment an organization sends feedback while
// the app is open, same as the FeedbackToast popup. `read` (not
// `notified`) is what this counts: see the module note in
// functions/main.py's feedback section for why those two flags are kept
// separate.
function useUnreadFeedbackCount(user, role) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user || (role !== 'user' && role !== 'pending_org')) {
      setCount(0);
      return undefined;
    }
    const q = query(collection(db, 'users', user.uid, 'feedback'), where('read', '==', false));
    return onSnapshot(q, (snap) => setCount(snap.size));
  }, [user, role]);

  return count;
}

export function BottomNav() {
  const { user, role } = useAuth();
  const location = useLocation();
  const unreadFeedback = useUnreadFeedbackCount(user, role);
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
            <span className="bottom-nav-icon">
              <Icon />
              {item.badge && unreadFeedback > 0 && <span className="nav-badge">{unreadFeedback}</span>}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
