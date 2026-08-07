import { DEFAULT_DUCK_SKIN, duckSkinSrc } from './duckSkins.js';

// Shared by anywhere that renders a person's own avatar (BottomNav's user/
// pending_org avatar, Profile's identity header, ...) — a Google account's
// photo when one is set, else the member's chosen duck character (see
// duckSkins.js; defaults to duck1/"Straw Hat" for anyone who hasn't picked
// one yet). Deliberately not initials-based: that's an organization's
// avatar (a color-per-entity system), which doesn't fit a personal
// profile the same way.
export function UserAvatar({ photoURL, duckSkin = DEFAULT_DUCK_SKIN, className = 'user-avatar' }) {
  const isDuck = !photoURL;
  const src = photoURL || duckSkinSrc(duckSkin);
  return (
    <div className={className}>
      <img
        src={src}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 'inherit',
          objectFit: 'cover',
          // The duck illustrations are portrait-oriented (taller than
          // wide) with the character's face/hat concentrated in the top
          // third — a true center crop cuts into the hat and pushes the
          // face off-center in a round avatar frame. A real uploaded
          // photo has no such bias (people frame themselves reasonably
          // centered already), so this only nudges the duck fallback.
          objectPosition: isDuck ? 'center 10%' : 'center',
        }}
      />
    </div>
  );
}
