import { hashDuckAvatar, duckAvatarByIndex } from './tagTones.js';

// The brand duck-avatar (frontend/app/public/brand/duck-avatar*.png) — the
// "no logo yet" placeholder for a quest's owning organization. This
// occupies the exact visual slot a real uploaded org logo takes once one
// exists: pass `logoUrl` (organizations/{uid}.logoUrl, see
// update_organization_profile) and this renders that instead. Falls back to
// the duck whenever it's omitted/null: `duckColorIndex` (organizations/
// {uid}.duckColorIndex, assigned once at approval time — see main.py's
// _assign_duck_color_index) picks a color that's guaranteed unique across
// orgs, for as long as the palette has an unused slot left to give. Callers
// with no such org doc (a member reviewer's avatar in QuestReviewsList, for
// instance — nothing to keep unique there) can omit it and get the old
// pure-hash-from-seed color instead.
export function OrgAvatar({ name, seed, logoUrl, duckColorIndex }) {
  const duckSrc = typeof duckColorIndex === 'number'
    ? duckAvatarByIndex(duckColorIndex)
    : hashDuckAvatar(seed ?? name);
  return (
    <img
      src={logoUrl || duckSrc}
      alt=""
      className="org-avatar"
      aria-hidden="true"
    />
  );
}
