import { TAG_TONES } from './tagTones.js';

// Pastel pill for a quest tag / interest category. `tone` maps 1:1 to the
// ink-rack tokens in style.css (--tag-community, --tag-education, ...) —
// the same 9 values as the app's fixed interest list. Unknown/omitted tones
// fall back to the neutral paper-well fill.
//
// Two shapes: a plain display pill (always shown filled with its tone —
// used for a quest's tag list) and a selectable toggle (the interest
// picker in Onboarding), which starts unfilled and fills in once chosen.
const KNOWN_TONES = new Set(TAG_TONES);

function toneStyle(tone) {
  const key = tone && String(tone).toLowerCase().replace(/\s+/g, '-');
  if (!KNOWN_TONES.has(key)) return undefined;
  return {
    '--tag-color': `var(--tag-${key})`,
    '--tag-ink': `var(--tag-${key}-ink)`,
    '--tag-select-ink': `var(--tag-${key}-ink)`,
  };
}

export function TagStamp({ tone, children, selectable = false, selected = false, onClick }) {
  const style = toneStyle(tone);

  if (selectable) {
    return (
      <button
        type="button"
        className="tag-stamp"
        data-selectable="true"
        data-selected={selected ? 'true' : 'false'}
        style={style}
        onClick={onClick}
        aria-pressed={selected}
      >
        {children}
      </button>
    );
  }

  return (
    <span className="tag-stamp" data-selected="true" style={style}>
      {children}
    </span>
  );
}
