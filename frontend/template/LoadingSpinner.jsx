import { motion, useReducedMotion } from 'framer-motion';

// Replaces bare "Loading..." text everywhere data is being fetched. Under
// reduced motion, the ring holds still rather than spinning — the label
// alone still communicates the state.
export function LoadingSpinner({ label = 'Loading...' }) {
  const reduce = useReducedMotion();
  return (
    <div className="loading-spinner-row" role="status">
      <motion.span
        className="loading-spinner-ring"
        animate={reduce ? {} : { rotate: 360 }}
        transition={reduce ? {} : { repeat: Infinity, duration: 0.7, ease: 'linear' }}
      />
      <span>{label}</span>
    </div>
  );
}
