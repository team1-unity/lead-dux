import { DuckMark } from './Logo.jsx';

// Shared by anywhere that renders a person's own avatar (BottomNav's user/
// pending_org avatar, Profile's identity header, ...) — a Google account's
// photo when one is set, else the duck mascot. Deliberately not
// initials-based: that's an organization's avatar (a color-per-entity
// system), which doesn't fit a personal profile the same way.
export function UserAvatar({ photoURL, size = 40, className = 'user-avatar' }) {
  if (photoURL) {
    return (
      <div className={className}>
        <img
          src={photoURL}
          alt=""
          style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover' }}
        />
      </div>
    );
  }
  return (
    <div className={className} aria-hidden="true">
      <DuckMark size={size} />
    </div>
  );
}
