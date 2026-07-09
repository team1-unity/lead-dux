import { motion, useReducedMotion } from 'framer-motion';

// Thin convenience wrapper over the base <button> (which already carries
// the press-down hard-shadow treatment globally, see style.css) — this just
// adds the pastel-fill variant classes so screens don't repeat className
// logic, plus a framer-motion tap scale layered on top of the existing CSS
// press effect. `variant="default"` renders a plain outlined button.
export function StampButton({ variant = 'default', className = '', ...props }) {
  const reduce = useReducedMotion();
  const variantClass = variant === 'primary' ? 'ink-btn-primary' : variant === 'danger' ? 'ink-btn-danger' : '';
  const combined = [variantClass, className].filter(Boolean).join(' ');
  return (
    <motion.button
      className={combined || undefined}
      whileTap={reduce ? undefined : { scale: 0.97 }}
      {...props}
    />
  );
}
