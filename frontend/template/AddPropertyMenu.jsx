import { useEffect, useRef, useState } from 'react';

// A small accessible menu button shared by every document-style form that
// adds optional fields on demand (org/CreateQuestForm.jsx, the org About
// edit form in OrganizationProfile.jsx): aria-expanded, full arrow-key/
// Escape support, focus returns to the trigger on close. `items` is
// `{ key, label, disabled? }[]` — callers filter out already-added items
// themselves (see each call site) so this component doesn't need to know
// anything about a specific form's field set. Disabled items are skipped by
// arrow-key navigation and can't be activated.
export function AddPropertyMenu({ items, onSelect }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (!triggerRef.current?.parentElement?.contains(e.target)) close();
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function close() {
    setOpen(false);
    setActiveIndex(-1);
    triggerRef.current?.focus();
  }

  function openMenu() {
    setOpen(true);
    const firstEnabled = items.findIndex((it) => !it.disabled);
    setActiveIndex(firstEnabled);
  }

  useEffect(() => {
    if (open && activeIndex >= 0) itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  function moveFocus(delta) {
    let next = activeIndex;
    for (let i = 0; i < items.length; i += 1) {
      next = (next + delta + items.length) % items.length;
      if (!items[next].disabled) break;
    }
    setActiveIndex(next);
  }

  function onTriggerKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenu();
    }
  }

  function onMenuKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(-1);
    } else if (e.key === 'Tab') {
      close();
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={triggerRef}
        type="button"
        className="stamp-btn quest-form-ghost-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        + Add a property
      </button>
      {open && (
        <div
          className="ink-card quest-form-add-menu"
          role="menu"
          aria-label="Add a property"
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, i) => (
            <button
              key={item.key}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              aria-disabled={item.disabled || undefined}
              tabIndex={-1}
              className="quest-form-add-menu-item"
              onClick={() => {
                if (item.disabled) return;
                onSelect(item.key);
                close();
              }}
            >
              {item.label}
              {item.disabled && <span className="field-optional"> (coming soon)</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
