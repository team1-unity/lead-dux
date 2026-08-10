import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { db } from './firebaseapp.jsx';
import { useAuth } from './AuthContext.jsx';
import { callMarkIntroSeen } from './fetch.jsx';
import { StampButton } from './StampButton.jsx';
import { IconJournal, IconList, IconQrCode, IconTrophy } from './icons.jsx';

// pending_org sees the exact same quest-list interface a leader does while
// waiting on approval (see BottomNav.jsx's role maps) — the leader tour is
// exactly as relevant to them as it is to 'user'.
const LEADER_ROLES = ['user', 'pending_org'];

const LEADER_SLIDES = [
  {
    icon: IconList,
    title: 'Welcome! Find quests near you',
    body: 'Browse quests hosted by local organizations and RSVP to the ones that fit your interests and schedule.',
  },
  {
    icon: IconQrCode,
    title: 'Check in with a QR code',
    body: "When you arrive, scan the event's QR code from Check In to confirm you showed up and start earning points.",
  },
  {
    icon: IconJournal,
    title: 'Keep a Journal',
    body: "Every quest you attend gets a private space to reflect. Proud of how one went? You can request feedback from the organization there too, for a shot at bonus points.",
  },
  {
    icon: IconTrophy,
    title: 'Earn ranks and badges',
    body: 'Points climb you from Iron toward Diamond rank — leveling up unlocks tougher side quests and new badges along the way.',
  },
];

// A one-time feature walkthrough shown the first time a leader lands on
// their real home screen — never again after that (see mark_intro_seen in
// functions/main.py). Mounted once in AppShell, a sibling of every
// signed-in route, so it appears above whichever specific page happens to
// render first regardless of role. Re-evaluates whenever `role` changes
// (not just on mount) so it also picks up the live onboarding_user -> user
// transition within the same session, not only a fresh page load.
//
// organization no longer has a branch here — see frontend/org/
// OrgOnboarding.jsx, a full multi-step wizard mounted alongside this one
// in AppShell, which replaced the old 3-slide ORG_SLIDES (it only ever
// covered a third of what an org can actually do).
export function WelcomeTour() {
  const { user, role } = useAuth();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  const slides = LEADER_ROLES.includes(role) ? LEADER_SLIDES : null;

  useEffect(() => {
    setStep(0);
    if (!user || !slides) {
      setVisible(false);
      return undefined;
    }
    let cancelled = false;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      if (!cancelled) setVisible(!snap.exists() || !snap.data().introSeen);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, role]);

  if (!visible || !slides) return null;

  const slide = slides[step];
  const isLast = step === slides.length - 1;
  const Icon = slide.icon;

  async function dismiss() {
    setVisible(false);
    try {
      await callMarkIntroSeen();
    } catch {
      // Non-critical — worst case it shows once more next time they load the app.
    }
  }

  return (
    <AnimatePresence>
      <div className="tour-backdrop" role="dialog" aria-modal="true" aria-label="Welcome walkthrough">
        <TourCard slide={slide} Icon={Icon}>
          <div className="tour-dots">
            {slides.map((_, i) => (
              <span key={i} className="tour-dot" data-active={i === step ? 'true' : 'false'} />
            ))}
          </div>
          <div className="tour-actions">
            {!isLast && (
              <StampButton type="button" onClick={dismiss}>
                Skip
              </StampButton>
            )}
            {step > 0 && (
              <StampButton type="button" onClick={() => setStep((s) => s - 1)}>
                Back
              </StampButton>
            )}
            <StampButton
              type="button"
              variant="primary"
              style={{ marginLeft: isLast ? 'auto' : undefined }}
              onClick={isLast ? dismiss : () => setStep((s) => s + 1)}
            >
              {isLast ? 'Done' : 'Next'}
            </StampButton>
          </div>
        </TourCard>
      </div>
    </AnimatePresence>
  );
}

function TourCard({ slide, Icon, children }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={slide.title}
      className="ink-card tour-card"
      data-frame="cozy"
      initial={reduce ? false : { opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      <Icon className="tour-icon" />
      <h2>{slide.title}</h2>
      <p>{slide.body}</p>
      {children}
    </motion.div>
  );
}
