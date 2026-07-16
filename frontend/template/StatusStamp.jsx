// Filled pastel chip for a role or request status (admin dashboard, org
// approval state, Settings). The consuming screen decides what each tone
// means semantically (e.g. admin/Dashboard.jsx maps "approved" -> the
// "education" blue) — this component just renders whichever tone it's told.
// `muted` drops the fill entirely for "nothing to show yet" states
// (onboarding_user has no status worth stamping).
export function StatusStamp({ tone, muted = false, children }) {
  const style = !muted && tone ? { '--tag-color': `var(--tag-${tone})`, '--tag-ink': `var(--tag-${tone}-ink)` } : undefined;
  return (
    <span className="status-stamp" data-muted={muted ? 'true' : undefined} style={style}>
      {children}
    </span>
  );
}
