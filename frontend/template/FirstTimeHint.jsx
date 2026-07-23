import { useEffect, useState } from 'react';
import { hasSeenHint, markHintsSeen } from './firstTimeHints.js';

// One shared document-level listener (capture phase, so it fires before
// anything else can stopPropagation) rather than one per mounted hint —
// "disappear when anything gets clicked" means literally any click
// anywhere, so every visible hint just subscribes to the same broadcast
// instead of each wiring its own document listener.
let listenerInstalled = false;
function ensureDismissBroadcast() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  document.addEventListener(
    'click',
    () => window.dispatchEvent(new CustomEvent('lq-dismiss-hints')),
    { capture: true },
  );
}

// Wraps a nav item (or any element) with a themed callout bubble that
// shows exactly once per browser (localStorage-gated, see
// firstTimeHints.js) and vanishes the moment the visitor clicks anything.
// `placement` picks which side the bubble opens toward — pass 'top' for
// items in a bottom bar, 'bottom' for items in a top bar, so the bubble
// always points back at its item instead of off toward empty space.
export function FirstTimeHint({ id, text, placement = 'top', children }) {
  const [visible, setVisible] = useState(() => !hasSeenHint(id));

  useEffect(() => {
    if (!visible) return undefined;
    ensureDismissBroadcast();
    function dismiss() {
      setVisible(false);
      markHintsSeen(id);
    }
    window.addEventListener('lq-dismiss-hints', dismiss);
    return () => window.removeEventListener('lq-dismiss-hints', dismiss);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <span className="hint-anchor">
      {children}
      {visible && (
        <span className="hint-bubble" data-placement={placement} role="status">
          {text}
        </span>
      )}
    </span>
  );
}
