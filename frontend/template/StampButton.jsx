import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

// Thin convenience wrapper over the base <button> (which already carries
// the press-down hard-shadow treatment globally, see style.css) — this just
// adds the pastel-fill variant classes so screens don't repeat className
// logic, plus a framer-motion tap scale layered on top of the existing CSS
// press effect. `variant="default"` renders a plain outlined button.
//
// `as` swaps the rendered element/component (e.g. `as={Link} to="/register"`
// for a StampButton that navigates instead of submitting) — memoized so the
// motion(...)-wrapped component identity stays stable across renders; a
// fresh one every render would make React remount the DOM node each time.
export function StampButton({ as, variant = 'default', className = '', ...props }) {
  const reduce = useReducedMotion();
  const variantClass = variant === 'primary' ? 'ink-btn-primary' : variant === 'danger' ? 'ink-btn-danger' : '';
  const combined = ['stamp-btn', variantClass, className].filter(Boolean).join(' ');
  const Component = useMemo(() => (as ? motion(as) : motion.button), [as]);
  return (
    <Component
      className={combined || undefined}
      whileTap={reduce ? undefined : { scale: 0.96 }}
      transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
      {...props}
    />
  );
}
