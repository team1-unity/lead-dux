// Small persistent header: an optional page title. `title` is omitted on
// screens that already have their own heading (e.g. the quest feed). No
// avatar/profile link here — BottomNav already surfaces Profile and
// Settings on every screen, so a second path to the same place would be a
// decorative duplicate. `hero` renders the title much larger than a normal
// heading — used for an organization's own name on its dashboard, which
// should read as a headline, not just another section header.
export function TopBar({ title, hero = false }) {
  return (
    <div className="top-bar">
      {title ? <h1 className={hero ? 'top-bar-title-hero' : undefined}>{title}</h1> : <span aria-hidden="true" />}
    </div>
  );
}
