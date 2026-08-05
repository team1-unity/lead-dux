import { useEffect, useRef, useState } from 'react';
import { StampButton } from './StampButton.jsx';
import { LightboxBackdrop } from './LightboxBackdrop.jsx';
import { IconFilter } from './icons.jsx';

// Shared by every "Filters" button + popover/sheet surface (mobile/Quests.jsx's
// Type/Activity/Sort panel, EventsMap.jsx's Sort-only panel) — the open/
// closed state, outside-click/Escape-to-close (desktop only; the mobile
// sheet gets that for free from LightboxBackdrop), and focus-restore-on-
// close wiring, so each caller only has to build its own panel content.
export function useFilterPanel(isDesktop) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open || !isDesktop) return undefined;
    function onPointerDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, isDesktop]);

  // Restores focus to the trigger button whenever the panel closes, by
  // whichever path closed it (its own button, outside click, Escape, the
  // mobile sheet's Done/backdrop) — not just the ones triggered directly
  // by that button.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !open) btnRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);

  return { open, setOpen, wrapRef, btnRef };
}

// The trigger button itself — a rounded-square icon button matching every
// other control in the app (see .quest-filter-btn in style.css), picking up
// the accent color only once a filter is actually active or the panel is
// open, rather than a separate numeric badge floating off its corner.
export function FilterButton({ btnRef, open, onToggle, activeCount }) {
  return (
    <button
      ref={btnRef}
      type="button"
      className="quest-filter-btn"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Filters, ${activeCount} active`}
      data-filters-active={activeCount > 0 ? 'true' : undefined}
      onClick={onToggle}
    >
      <IconFilter width={22} height={22} />
    </button>
  );
}

// One selected/unselected pill look, reused for every filter group — just
// StampButton's own existing primary-vs-default variant, so "selected" is
// the same accent-filled look every other pill toggle in the app already
// has (see ThemePicker's theme-option row), not a new style invented just
// for this panel. `disabled` is a real <button disabled>, not just a color/
// opacity change, so it's actually unclickable, not merely styled to look
// that way.
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
// covers a corner of the page, not all of it, so (unlike LightboxBackdrop's
// full-viewport dim) there's no backdrop at all here. Closing on outside
// click/Escape is handled by useFilterPanel above, which watches the whole
// wrapping element this renders inside of — no ref of its own needed here.
export function DesktopFilterPopover({ children }) {
  return (
    <div className="quest-filter-popover" role="dialog" aria-label="Filters">
      {children}
    </div>
  );
}

// Mobile presentation: a centered modal card, the same full-viewport
// backdrop every other modal in this app already uses (see
// LightboxBackdrop — backdrop tap/Escape-to-close, and its default centered
// layout, come for free from there, no override needed). Filtering itself
// is already live/instant (all client-side, no network re-query), so "Done"
// is only a dismiss action, not a gate on when selections take effect.
export function MobileFilterSheet({ onClose, children }) {
  return (
    <LightboxBackdrop onClose={onClose} label="Filters">
      <div className="quest-filter-sheet" onClick={(e) => e.stopPropagation()}>
        {children}
        <StampButton type="button" variant="primary" style={{ width: '100%' }} onClick={onClose}>
          Done
        </StampButton>
      </div>
    </LightboxBackdrop>
  );
}
