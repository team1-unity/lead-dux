// The LEAD-DUX brand mark — the full logo-lockup asset (duck + baked-in
// wordmark, frontend/app/public/brand/logo-lockup.png), set via the
// --duck-mark-url token in style.css rather than a plain <img src> (kept
// as a token, not hardcoded here, since a couple of surfaces still want
// to override it independently of the base rule). No longer theme-swapped
// — logo-lockup.png only has the one fixed colorway, unlike the old
// duck-brown/duck-yellow pair this replaced. Size is set
// via the --duck-size custom property (see .duck-mark in style.css)
// rather than an inline width/height, so a caller's own className (e.g.
// .auth-hero-duck) can still override the size with a plain CSS rule.
export function DuckMark({ size = 32, className }) {
  return (
    <span
      className={['duck-mark', className].filter(Boolean).join(' ')}
      role="img"
      aria-hidden="true"
      style={{ '--duck-size': `${size}px` }}
    />
  );
}

// Full lockup (icon + wordmark). `tone="brand"` renders the true logo
// colorway (mustard wordmark), meant only for placement directly on the
// brand-green surface (login/marketing screens) — everywhere else the
// wordmark inherits its color from context (e.g. --line on a white topbar)
// so it never renders low-contrast yellow-on-white.
export function Logo({ size = 28, showWordmark = true, tone = 'default', className }) {
  return (
    <span
      className={['lq-logo', className].filter(Boolean).join(' ')}
      data-tone={tone}
    >
      <DuckMark size={size} />
      {showWordmark && <span className="lq-logo-word">LEAD&middot;DUX</span>}
    </span>
  );
}

// The exact brand asset (frontend/app/public/brand/logo-lockup.png, duck +
// baked-in mustard wordmark) — for a green marketing/hero surface only,
// where that fixed colorway is precisely what the brand asset intends.
// Everywhere else, `Logo` (icon + live-colored text) is the flexible one.
export function BrandLockup({ width = 240, className }) {
  return (
    <img
      src="/brand/logo-lockup.png"
      width={width}
      height={(width * 1080) / 1920}
      className={className}
      alt="LEAD-DUX"
    />
  );
}
