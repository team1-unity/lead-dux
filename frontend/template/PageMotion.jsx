import { motion, useReducedMotion } from 'framer-motion';

// Wraps a top-level page's outermost element with a fade+slide-up on
// mount. Deliberately not a route-level AnimatePresence crossfade (that
// needs restructuring <Routes> for exit animations) — this covers "the
// site feels static" without touching routing.
export function PageMotion({ children, className }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      // A touch of blur alongside the fade+slide — every other transition
      // in the app is a flat opacity/color/scale change, and this is the
      // one moment (an entire page arriving) that can afford something a
      // little more physical: the content reads as pulling into focus,
      // not just fading up. Kept small (4px) and short (0.32s) so it
      // registers as texture, not a visible smear.
      initial={reduce ? false : { opacity: 0, y: 10, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.32, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
