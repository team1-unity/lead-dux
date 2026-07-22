import { motion, useReducedMotion } from 'framer-motion';
import { AmbientParticles } from './AmbientParticles.jsx';
import { DuckMark } from './Logo.jsx';

// Shared frame for every pre-login screen (Login, Register, Forgot/Reset
// password, Onboarding) — so the screens read as one connected flow rather
// than ad hoc forms. On mobile this is a plain, card-less column (icon +
// wordmark stacked above the form, floating directly on the page) — on
// desktop it becomes the brand-green/white full-bleed split screen. The
// mount animation lives here rather than via PageMotion in each screen,
// since every auth screen wants the exact same fade+slide-up.
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
        <div className="auth-card-hero">
          <div className="auth-hero-brand">
            <DuckMark className="auth-hero-duck" size={48} />
            <span className="auth-hero-word">LEAD&middot;DUX</span>
          </div>
          <p>Community quests, one turn at a time.</p>
        </div>
        <div className="auth-card-form">
          <h1>{title}</h1>
          {children}
          {footer && <div className="auth-footer">{footer}</div>}
        </div>
      </motion.div>
    </div>
  );
}
