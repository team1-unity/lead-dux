// The LEAD-DUX brand mark: a duck on a pond, from the real brand asset
// (frontend/app/public/brand/duck-mark.png) — a transparent-background PNG,
// so it drops onto any surface/theme without a color-matched background.
export function DuckMark({ size = 32, className }) {
  return (
    <img
      src="/brand/duck-mark.png"
      width={size}
      height={(size * 889) / 1322}
      className={className}
      alt=""
      aria-hidden="true"
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
