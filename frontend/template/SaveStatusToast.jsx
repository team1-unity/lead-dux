import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { subscribe } from './saveStatusBus.js';
import { IconX } from './icons.jsx';

const AUTO_DISMISS_MS = 6000;

// Mounted once in AppShell (see App.jsx) so it outlives whatever modal
// triggered the error it's reporting — see saveStatusBus.js and
// EditProfileModal.jsx's optimistic handleSave, the only publisher today.
export function SaveStatusToast() {
  const [message, setMessage] = useState(null);
  const reduce = useReducedMotion();

  useEffect(() => subscribe(setMessage), []);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(null), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          role="status"
          className="box-danger"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 'calc(var(--bottom-nav-height, 64px) + 16px)',
            transform: 'translateX(-50%)',
            zIndex: 200,
            maxWidth: 'min(90vw, 420px)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            paddingRight: 12,
          }}
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: 12 }}
          transition={{ duration: 0.2 }}
        >
          <p style={{ margin: 0, flex: 1 }}>{message}</p>
          <button
            type="button"
            onClick={() => setMessage(null)}
            aria-label="Dismiss"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', flexShrink: 0 }}
          >
            <IconX width={16} height={16} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
