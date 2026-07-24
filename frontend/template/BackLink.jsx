import { Link } from 'react-router-dom';
import { IconChevron } from './icons.jsx';

// A small "‹ Back to X" affordance for pages reached by drilling into
// something else (a quest's detail, an org's profile, Settings) rather than
// a direct bottom-nav destination — those don't need this, BottomNav is
// always visible. `to` is a fixed destination rather than browser history:
// how someone actually arrived varies (a share link, a search result, a
// preview card), so a stable, truthful target beats an unpredictable one.
export function BackLink({ to, label }) {
  return (
    <Link to={to} className="back-link">
      <IconChevron style={{ transform: 'rotate(90deg)' }} />
      Back to {label}
    </Link>
  );
}
