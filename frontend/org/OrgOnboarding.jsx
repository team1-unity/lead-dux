import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '@shared/AuthContext.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { callMarkIntroSeen } from '@shared/fetch.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { TrustTag } from '@shared/TrustTag.jsx';
import { IconGrid, IconQrCode, IconCheck, IconMail, IconJournal, IconGlobe } from '@shared/icons.jsx';

// One screen per org feature, same wizard mechanics as mobile/Onboarding.jsx
// (progress bar, Back/Continue, one topic at a time so it reads as a short
// tour rather than a wall of slides) — built for this branch's org side
// specifically, in place of WelcomeTour.jsx's old 3-slide ORG_SLIDES, which
// only ever covered a third of what an org can actually do here.
const STEPS = [
  {
    title: 'Your Dashboard',
    icon: IconGrid,
    body: 'Your dashboard shows what needs attention at a glance: pending photo submissions, pending feedback requests, and your upcoming quests.',
  },
  {
    title: 'Creating & Managing Quests',
    icon: IconQrCode,
    body: 'Post a one-time quest or a recurring series, with tags and accessibility notes for who it fits. Each date gets its own QR code — volunteers scan it to check in.',
  },
  {
    title: 'Photo Submissions',
    icon: IconCheck,
    body: "Checking in already confirms someone showed up. Afterward, they can optionally upload a photo for bonus points, which you approve or reject — and any approved photo can be added straight to your public gallery.",
  },
  {
    title: 'Feedback Requests',
    icon: IconMail,
    body: 'Volunteers can request feedback on how they did. You answer a short 5-question rubric — it becomes part of their record, and a shot at bonus points for them.',
  },
  {
    title: 'Trust Score & Profile',
    icon: IconGlobe,
    body: 'Every review your quests get feeds your Trust Score. Keep it healthy and volunteers see you as Trustworthy; let it slip and you land Under Review. Fill out your mission, links, and tags so people know who you are.',
    visual: <TrustTag status="trustworthy" />,
  },
  {
    title: 'Host Journal',
    icon: IconJournal,
    body: "After each quest happens, jot a private reflection — what went well, what didn't, what you'd change. Visible only to you.",
  },
];

// Self-contained, org-only replacement for WelcomeTour.jsx's old 3-slide
// ORG_SLIDES — lives here (not in template/) rather than being folded into
// WelcomeTour itself, since template/ is the shared base layer every role
// depends on and nothing there imports from @org/ today; this keeps that
// direction intact. Mounted directly in App.jsx's AppShell, alongside
// <WelcomeTour /> (which now only ever renders for leader roles). Reuses
// the same introSeen field/mark_intro_seen call WelcomeTour already relies
// on, so an org that already dismissed the old slide tour won't have this
// replay — dismissing either one flips the same flag.
export function OrgOnboarding() {
  const { user, role } = useAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user || role !== 'organization') {
      setVisible(false);
      return undefined;
    }
    let cancelled = false;
    getDoc(doc(db, 'organizations', user.uid)).then((snap) => {
      if (!cancelled) setVisible(!snap.exists() || !snap.data().introSeen);
    });
    return () => {
      cancelled = true;
    };
  }, [user, role]);

  async function complete() {
    setVisible(false);
    try {
      await callMarkIntroSeen();
    } catch {
      // Non-critical — worst case it shows once more next time they load the app.
    }
  }

  if (!visible) return null;
  return <OrgOnboardingWizard onComplete={complete} />;
}

function OrgOnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(0);
  const reduce = useReducedMotion();
  const isLast = step === STEPS.length - 1;
  const slide = STEPS[step];
  const Icon = slide.icon;

  return (
    <div className="tour-backdrop" role="dialog" aria-modal="true" aria-label="Organization walkthrough">
      <div className="ink-card tour-card org-onboarding-card">
        <button type="button" className="tour-close" onClick={onComplete} aria-label="Skip walkthrough">
          &times;
        </button>

        <div className="onboarding-progress">
          <div className="onboarding-progress-fill" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
        <p className="field-optional" style={{ margin: '0 0 12px' }}>
          Step {step + 1} of {STEPS.length}
        </p>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={reduce ? false : { opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? undefined : { opacity: 0, x: -10 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="org-onboarding-slide"
          >
            <Icon className="tour-icon" />
            <h2>{slide.title}</h2>
            <p>{slide.body}</p>
            {slide.visual && <div style={{ marginTop: 10 }}>{slide.visual}</div>}
          </motion.div>
        </AnimatePresence>

        <div className="tour-actions" style={{ marginTop: 22 }}>
          {!isLast && (
            <StampButton type="button" onClick={onComplete}>
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
            onClick={isLast ? onComplete : () => setStep((s) => s + 1)}
          >
            {isLast ? 'Done' : 'Next'}
          </StampButton>
        </div>
      </div>
    </div>
  );
}
