import { useEffect, useState } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { motion, useReducedMotion } from 'framer-motion';
import { db } from '@shared/firebaseapp.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { BackLink } from '@shared/BackLink.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { callCheckInToEvent, callDemoCheckIn } from '@shared/fetch.jsx';
import { IconCheck, IconAlert } from '@shared/icons.jsx';

const EASE_OUT = [0.23, 1, 0.32, 1];

// Where an event QR's own URL actually points (see functions/main.py's
// _check_in_url) — reached either directly (any camera app can open a real
// URL, not just this app's own scanner) or via QuestScanner.jsx decoding
// that same QR and navigating here itself. Either way, this is the one
// place that actually calls check_in_to_event and shows the result, so a
// code scanned outside the app behaves identically to one scanned inside
// it.
//
// Deliberately outside AppShell (see App.jsx, same reasoning as
// SharedQuest.jsx) — a freshly scanned link should work the moment it
// opens, not depend on already being deep in the app's own nav chrome.
export function CheckInConfirm() {
  const { questId, token } = useParams();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const reduce = useReducedMotion();
  // Set by CheckIn.jsx's demo-student-only keyboard shortcut (press "C" on
  // the real scanner screen) instead of an actual decoded QR — the check-in
  // itself already happened (see callDemoForceCheckIn there) by the time
  // this page ever mounts, so there's nothing left here to call or wait
  // on, just this same success UI to show for it. questId/token in the URL
  // are placeholders in this case, never looked up.
  const simulated = Boolean(location.state?.simulated);
  // 'pending' | 'success' | 'already' | 'error'
  const [state, setState] = useState(simulated ? (location.state.alreadyCheckedIn ? 'already' : 'success') : 'pending');
  const [result, setResult] = useState(simulated ? location.state : null);
  const [error, setError] = useState('');
  // null while unknown, then true/false — read straight off the quest doc
  // (quests/{questId}'s `allow get: if true`, same public read SharedQuest.jsx
  // relies on) so this can be checked before deciding whether the sign-in
  // gate below even applies. See functions/main.py's demo_check_in and
  // seed_demo_data.py's seed_demo_showcase for what sets this flag. Already
  // known true for a simulated visit — nothing to look up.
  const [isDemoQuest, setIsDemoQuest] = useState(simulated ? true : null);

  useEffect(() => {
    if (simulated) return undefined;
    let cancelled = false;
    getDoc(doc(db, 'quests', questId)).then((snap) => {
      if (!cancelled) setIsDemoQuest(snap.exists() && Boolean(snap.data().isDemoQuest));
    });
    return () => {
      cancelled = true;
    };
  }, [simulated, questId]);

  useEffect(() => {
    if (simulated || isDemoQuest === null) return undefined;
    // The demo quest never needs a signed-in caller (see demo_check_in) —
    // whoever scans it, logged in or not, gets attributed to the fixed demo
    // student instead of themselves. Every other quest keeps the original
    // "wait for auth, then check the real caller in" behavior untouched.
    if (!isDemoQuest && (authLoading || !user)) return undefined;
    let cancelled = false;
    const checkIn = isDemoQuest ? callDemoCheckIn(token) : callCheckInToEvent({ questId, token });
    checkIn
      .then((res) => {
        if (cancelled) return;
        setResult(res);
        setState(res.alreadyCheckedIn ? 'already' : 'success');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Could not check you in.');
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [simulated, isDemoQuest, authLoading, user, questId, token]);

  if (!simulated && (isDemoQuest === null || authLoading)) return <LoadingSpinner />;

  // Not signed in — this URL can be opened cold (a native camera app, or a
  // link tapped from outside the app entirely), so there's no guarantee of
  // an existing session the way most of the app can assume. No redirect-
  // back-after-login plumbing here on purpose: the QR itself is a durable,
  // reusable link (see _check_in_url — no per-scan one-time token), so
  // "log in, then scan again" is a real fallback, not a dead end. Skipped
  // entirely for the demo quest, which never requires a caller at all.
  if (!isDemoQuest && !user) {
    return (
      <PageMotion>
        <BackLink to="/" label="Home" />
        <div className="ink-card check-in-confirmation">
          <p>You need to be signed in to check in to this quest.</p>
          <Link to="/login">
            <StampButton type="button" variant="primary">Log in</StampButton>
          </Link>
          <p className="field-optional" style={{ marginTop: 4 }}>
            Once you're signed in, scan this code again to finish checking in.
          </p>
        </div>
      </PageMotion>
    );
  }

  if (state === 'pending') {
    return (
      <PageMotion>
        <BackLink to="/" label="Home" />
        <div className="ink-card check-in-confirmation">
          <LoadingSpinner label="Checking you in..." />
        </div>
      </PageMotion>
    );
  }

  if (state === 'error') {
    return (
      <PageMotion>
        <BackLink to="/" label="Home" />
        <div className="ink-card check-in-confirmation">
          <span className="check-in-confirmation-icon" data-tone="danger">
            <IconAlert width={32} height={32} />
          </span>
          <h1>Couldn't check you in</h1>
          <p>{error}</p>
          <Link to="/">
            <StampButton type="button">Back to Home</StampButton>
          </Link>
        </div>
      </PageMotion>
    );
  }

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
          data-tone="success"
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
          {state === 'already' ? "You're already checked in!" : 'Checked in successfully!'}
        </motion.h1>
        {state === 'success' && (
          <motion.p
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: EASE_OUT, delay: reduce ? 0 : 0.22 }}
          >
            You earned {result.pointsAwarded} Leadership Point{result.pointsAwarded === 1 ? '' : 's'}.
          </motion.p>
        )}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: EASE_OUT, delay: reduce ? 0 : 0.29 }}
        >
          <Link to="/">
            <StampButton type="button" variant="primary">Back to Home</StampButton>
          </Link>
        </motion.div>
      </div>
    </PageMotion>
  );
}
