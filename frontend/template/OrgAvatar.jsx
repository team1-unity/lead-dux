import { hashDuckAvatar, duckAvatarByIndex, hashTone } from './tagTones.js';

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
//
// `isDefault` is the one exception to all of the above: a side/default
// quest isn't owned by any organization at all (orgName/orgId are both
// None server-side — see create_default_quest in functions/main.py), so a
// duck (which reads as "an org with no logo yet") is the wrong signal to
// give it — there's no org to eventually upload a logo. Pass it for a "?"
// instead, colored via hashTone(seed) the same way the old letter-tile
// fallback colored itself before every org got its own duck — skipping
// the logoUrl/duckColorIndex logic entirely, since neither means anything
// for a quest with no owning org.
export function OrgAvatar({ name, seed, logoUrl, duckColorIndex, isDefault }) {
  if (isDefault) {
    const tone = hashTone(seed ?? name);
    return (
      <div
        className="org-avatar org-avatar-unknown"
        style={{ '--tag-color': `var(--tag-${tone})`, '--tag-ink': `var(--tag-${tone}-ink)` }}
        aria-hidden="true"
      >
        ?
      </div>
    );
  }
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
