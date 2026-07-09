import { motion, useReducedMotion } from 'framer-motion';
import { AmbientParticles } from './AmbientParticles.jsx';

// Shared frame for every pre-login screen (Login, Register, Forgot/Reset
// password, Onboarding) — a centered card, so the screens read as one
// connected flow rather than ad hoc forms. The mount animation lives here
// rather than via PageMotion in each screen, since every auth screen wants
// the exact same fade+slide-up on its one card.
export function AuthShell({ title, children, footer }) {
  const reduce = useReducedMotion();
  return (
    <div className="auth-shell">
      <AmbientParticles />
      <motion.div
        className="ink-card auth-card"
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <h1>{title}</h1>
        {children}
      </motion.div>
      {footer && <div className="auth-footer">{footer}</div>}
    </div>
  );
}
