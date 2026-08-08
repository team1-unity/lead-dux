import { useLayoutEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

// Smooth height+opacity reveal for expand/collapse toggles (rank milestones,
// journal entries, quest reviews, photo-submission groups) — replaces a bare
// `{open && children}` conditional, which mounts/unmounts the content
// instantly and reads as a layout jump rather than something opening or
// closing. AnimatePresence's `exit` is what lets the collapse animate too,
// not just the expand — a plain conditional never runs it, since React
// unmounts the node before any exit transition gets a chance to play.
export function Collapse({ open, children }) {
  const reduce = useReducedMotion();
  // `overflow: hidden` only while the height itself is actually animating —
  // some of this content (org/Quests.jsx's delete-series dropdown, in
  // particular) renders its own position:absolute menu that must be able to
  // draw outside the collapsed region's own flow-height once it's settled
  // open. Reset synchronously (useLayoutEffect, not useEffect) the moment
  // `open` flips false, so the close animation is never caught still
  // `visible` for a frame while it's shrinking back down.
  const [settled, setSettled] = useState(false);
  useLayoutEffect(() => {
    if (!open) setSettled(false);
  }, [open]);

  if (reduce) return open ? children : null;

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="content"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
          onAnimationComplete={() => setSettled(true)}
          style={{ overflow: settled ? 'visible' : 'hidden' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
