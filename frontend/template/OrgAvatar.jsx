import { hashTone } from './tagTones.js';

// A bold colored initial tile — the "no logo yet" placeholder for a quest's
// owning organization. This occupies the exact visual slot a real uploaded
// org logo takes once one exists: pass `logoUrl` (organizations/{uid}.
// logoUrl, see update_organization_profile) and this renders that instead —
// falls back to the letter tile whenever it's omitted/null, so every
// existing caller that doesn't know about logos yet keeps working unchanged.
export function OrgAvatar({ name, seed, logoUrl }) {
  if (logoUrl) {
    return <img src={logoUrl} alt="" className="org-avatar" aria-hidden="true" />;
  }
  const tone = hashTone(seed ?? name);
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div
      className="org-avatar"
      style={{ '--tag-color': `var(--tag-${tone})`, '--tag-ink': `var(--tag-${tone}-ink)` }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}
