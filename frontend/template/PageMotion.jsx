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
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
