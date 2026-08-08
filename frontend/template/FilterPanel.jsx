import { StampButton } from './StampButton.jsx';
import { LightboxBackdrop } from './LightboxBackdrop.jsx';

// Generic pieces of the "Filters" icon button → popover/modal pattern,
// shared between mobile/Quests.jsx (Explore Quests) and EventsMap.jsx (the
// map view) — each caller supplies its own filter groups as children, and
// its own button/open-state wiring (outside-click/Escape effect on
// desktop), since those parts are specific to what's being filtered.

// One selected/unselected pill look — just StampButton's own existing
// primary-vs-default variant, so "selected" is the same accent-filled
// look every other pill toggle in the app already has (see ThemePicker's
// theme-option row), not a new style invented just for filter panels.
// `disabled` renders a real <button disabled>, not just a color/opacity
// change, so it's actually unclickable, not merely styled to look that way.
export function FilterPill({ selected, disabled, onClick, children }) {
  return (
    <StampButton
      type="button"
      variant={selected ? 'primary' : 'default'}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </StampButton>
  );
}

// Desktop presentation: an anchored popover, not a full-screen modal — it
// covers a corner of the page, not all of it, so (unlike
// LightboxBackdrop's full-viewport dim) there's no backdrop at all here.
// Closing on outside click/Escape is the caller's own job (an effect
// watching whichever element wraps both the trigger button and this
// popover) — this component has no ref of its own to offer that with.
export function DesktopFilterPopover({ children, label = 'Filters' }) {
  return (
    <div className="quest-filter-popover" role="dialog" aria-label={label}>
      {children}
    </div>
  );
}

// Mobile presentation: a centered modal card, the same full-viewport
// backdrop every other modal in this app already uses (see
// LightboxBackdrop — backdrop tap/Escape-to-close, and its default
// centered layout, come for free from there, no override needed), same
// treatment as Attendees/QR/EditProfile's own modals rather than a bottom
// sheet (a sheet flush against the screen edges read as a clipped/cut-off
// box, not a deliberate surface). Filtering itself is already live/instant
// (all client-side, no network re-query), so "Done" is only a dismiss
// action, not a gate on when selections take effect.
export function MobileFilterSheet({ onClose, children, label = 'Filters' }) {
  return (
    <LightboxBackdrop onClose={onClose} label={label}>
      <div className="quest-filter-sheet" onClick={(e) => e.stopPropagation()}>
        {children}
        <StampButton type="button" variant="primary" style={{ width: '100%' }} onClick={onClose}>
          Done
        </StampButton>
      </div>
    </LightboxBackdrop>
  );
}
