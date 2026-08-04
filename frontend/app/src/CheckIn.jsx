import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { PageMotion } from '@shared/PageMotion.jsx';
import { QuestScanner } from '@shared/QuestScanner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { BackLink } from '@shared/BackLink.jsx';
import { IconCheck } from '@shared/icons.jsx';

const EASE_OUT = [0.23, 1, 0.32, 1];

// The user-facing half of the event-QR redesign: an organization displays
// one QR per event (see the org/admin dashboard's Generate/View/Refresh QR
// controls), and this is where an attendee scans it to check themself in.
export function CheckIn() {
  const [result, setResult] = useState(null);
  const reduce = useReducedMotion();

  if (result && !result.alreadyCheckedIn) {
    return (
      <PageMotion>
        <BackLink to="/" label="Home" />
        <div className="ink-card check-in-confirmation">
          {/* This is the one moment the whole app is building toward — a
              completed quest — so it's the one place that earns a bouncier,
              slower-settling entrance than anywhere else (a plain fade
              would treat "you just earned points" the same as landing on
              a settings page). The checkmark pops first with a touch of
              spring overshoot, then the rest follows as a quick staggered
              cascade rather than all at once. */}
          <motion.span
            className="check-in-confirmation-icon"
            initial={reduce ? false : { scale: 0.4, opacity: 0, filter: 'blur(4px)' }}
            animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
            transition={{ type: 'spring', duration: 0.5, bounce: 0.35 }}
          >
            <IconCheck width={32} height={32} />
          </motion.span>
          <motion.h1
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: EASE_OUT, delay: reduce ? 0 : 0.15 }}
          >
            Checked in successfully!
          </motion.h1>
          <motion.p
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: EASE_OUT, delay: reduce ? 0 : 0.22 }}
          >
            You earned {result.pointsAwarded} Leadership Point{result.pointsAwarded === 1 ? '' : 's'}.
          </motion.p>
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: EASE_OUT, delay: reduce ? 0 : 0.29 }}
          >
            <StampButton type="button" variant="primary" onClick={() => setResult(null)}>
              Scan another code
            </StampButton>
          </motion.div>
        </div>
      </PageMotion>
    );
  }

  return (
    <PageMotion>
      <BackLink to="/" label="Home" />
      <h1>Scan QR Code</h1>
      <p>Point your camera at the event's check-in code, displayed by the organization at the event.</p>
      <QuestScanner onCheckedIn={setResult} />
    </PageMotion>
  );
}
