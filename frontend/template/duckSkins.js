// The illustrated duck characters a member can pick as their own avatar
// fallback (Profile's "Edit Profile" modal) — whitelisted server-side too
// (see DUCK_SKINS in functions/main.py's update_user_profile), so this
// list and that one must stay in sync if a duck is ever added or removed.
export const DUCK_SKINS = [
  { id: 'duck1', src: '/brand/duck1.png', label: 'Straw Hat' },
  { id: 'duck2', src: '/brand/duck2.png', label: 'Bow' },
  { id: 'duck3', src: '/brand/duck3.png', label: 'Chef' },
  { id: 'duck4', src: '/brand/duck4.png', label: 'Frog' },
];

export const DEFAULT_DUCK_SKIN = 'duck1';

export function duckSkinSrc(duckSkin) {
  return DUCK_SKINS.find((d) => d.id === duckSkin)?.src ?? DUCK_SKINS[0].src;
}
