// Small hand-picked inline icon set. Deliberately plain/geometric rather
// than rough.js-jittered — at 20-24px, a wobbly stroke reads as blurry, not
// hand-drawn. Rough.js texture is reserved for larger surfaces (cards,
// thumbnails); nav icons stay crisp.

export function IconList(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="4" y="5" width="16" height="4.5" rx="1" />
      <rect x="4" y="14.5" width="16" height="4.5" rx="1" />
    </svg>
  );
}

export function IconGrid(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </svg>
  );
}

export function IconGear(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M17.7 6.3l-1.5 1.5M7.8 16.2l-1.5 1.5M17.7 17.7l-1.5-1.5M7.8 7.8L6.3 6.3" />
    </svg>
  );
}

export function IconPerson(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M4.5 20c1.3-3.8 4.2-5.8 7.5-5.8s6.2 2 7.5 5.8" />
    </svg>
  );
}

export function IconPlus(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconChevron(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M7 9.5l5 5 5-5" />
    </svg>
  );
}

export function IconCalendar(props) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="4" y="5.5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8 3.5v3M16 3.5v3" />
    </svg>
  );
}

export function IconPin(props) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 21s7-6.6 7-11.5A7 7 0 0 0 5 9.5C5 14.4 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.4" />
    </svg>
  );
}

export function IconUsers(props) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3 19c1-3.2 3.3-4.8 6-4.8s5 1.6 6 4.8" />
      <path d="M16 8.2a2.6 2.6 0 1 1 0-5.2M18.5 14.5c2 .5 3 1.8 3.5 4.5" />
    </svg>
  );
}

export function IconCheck(props) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M4 12.5l5.5 5.5L20 6.5" />
    </svg>
  );
}

export function IconAlert(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 3.5L21.5 20h-19L12 3.5z" />
      <path d="M12 9.5v5M12 17.5h.01" />
    </svg>
  );
}

export function IconSearch(props) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.8-4.8" />
    </svg>
  );
}

export function IconFilter(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" {...props}>
      <path d="M4 7h16M7 12h10M10 17h4" />
    </svg>
  );
}

export function IconEdit(props) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M15.5 3.5l5 5-11 11-5.5.75.75-5.5z" />
    </svg>
  );
}

export function IconTrophy(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M6 4h12v3a6 6 0 0 1-12 0z" />
      <path d="M6 5H3v2a3 3 0 0 0 3 3M18 5h3v2a3 3 0 0 1-3 3M9 15h6M8 20h8M12 13v2" />
    </svg>
  );
}

export function IconHeart(props) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 20.5s-7.5-4.6-10-9.3C.4 7.7 2 4 5.6 4c2 0 3.4 1.1 4.4 2.6C11 5.1 12.4 4 14.4 4 18 4 19.6 7.7 22 11.2c-2.5 4.7-10 9.3-10 9.3z" />
    </svg>
  );
}

export function IconLock(props) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </svg>
  );
}

export function IconJournal(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 6.2c-1.6-1.3-3.6-2-6-2v13.6c2.4 0 4.4.7 6 2 1.6-1.3 3.6-2 6-2V4.2c-2.4 0-4.4.7-6 2Z" />
      <path d="M12 6.2v13.6" />
    </svg>
  );
}

export function IconGlobe(props) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.3 3.7 5.3 3.7 8.5s-1.3 6.2-3.7 8.5c-2.4-2.3-3.7-5.3-3.7-8.5S9.6 5.8 12 3.5z" />
    </svg>
  );
}

export function IconMail(props) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M4.5 6.5l7.5 6 7.5-6" />
    </svg>
  );
}

export function IconPhone(props) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M6 3.5h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3c0 1-.9 1.8-1.9 1.6-6-1.1-10.6-5.7-11.7-11.7C4.2 4.4 5 3.5 6 3.5z" />
    </svg>
  );
}

// Social icons are deliberately plain/geometric glyphs (a stylized initial
// or shape), not pixel-accurate brand logos — same "hand-picked, not
// jittered" philosophy as the rest of this file (see header comment).
export function IconInstagram(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="16.8" cy="7.2" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconFacebook(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M14.5 21v-7.5H17l.5-3.5h-3V7.8c0-1 .3-1.8 1.8-1.8h1.8V2.8C17.8 2.7 16.7 2.5 15.4 2.5c-3 0-4.9 1.8-4.9 5v2.5H7.5v3.5H10.5V21" />
    </svg>
  );
}

export function IconX(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M4.5 4.5l15 15M19.5 4.5l-15 15" />
    </svg>
  );
}

export function IconLinkedIn(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M7.7 10.2v6.3M7.7 7.6v.02M11.3 16.5v-3.8c0-1.4 1-2.5 2.4-2.5s2.1 1 2.1 2.5v3.8" />
    </svg>
  );
}

export function IconTikTok(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M14 3.5v11.2a3.3 3.3 0 1 1-3.3-3.3" />
      <path d="M14 3.5c0 2.6 2 4.6 4.5 4.6" />
    </svg>
  );
}

export function IconYouTube(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="4" />
      <path d="M10.5 9.5l5 2.5-5 2.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}
