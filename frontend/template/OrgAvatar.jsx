import { hashTone } from './tagTones.js';

// A bold colored initial tile — the "no logo yet" placeholder for a quest's
// owning organization. This occupies the exact visual slot a real uploaded
// org logo would take later; swapping in an <img> here (once orgs can
// upload one) is the whole migration, nothing else about the layout needs
// to change.
export function OrgAvatar({ name, seed }) {
  const tone = hashTone(seed ?? name);
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div className="org-avatar" style={{ '--tag-color': `var(--tag-${tone})` }} aria-hidden="true">
      {initial}
    </div>
  );
}
