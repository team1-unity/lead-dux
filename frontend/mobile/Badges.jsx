import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { useIsDesktop } from '@shared/useIsDesktop.js';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { BackLink } from '@shared/BackLink.jsx';
import { usePreviousPath } from '@shared/PreviousPathContext.jsx';
import { labelForPath } from '@shared/routeLabels.js';
import { TopBar } from '@shared/TopBar.jsx';
import { callMarkBadgesSeen } from '@shared/fetch.jsx';
import { computeBadges, getLocallySeenBadgeIds, markBadgesSeenLocally } from '@shared/badges.js';
import { badgeSpritePosition } from '@shared/badgeSprite.js';
import { hashTone } from '@shared/tagTones.js';
import { IconLock } from '@shared/icons.jsx';

// A single badge's ring — earned (tag-tinted fill + its sprite icon),
// in-progress (plain ring), or undiscovered (locked, muted fill). The
// name/description only ever reaches the DOM as visually-hidden text: the
// wireframe this screen matches is deliberately iconography-only, but a
// screen reader user still needs to know what each circle means.
// `isNew` draws a small ribbon for a badge earned since the last visit —
// see Badges.jsx's seen-tracking effect.
export function BadgeRing({ badge, size, locked = false, isNew = false }) {
  const reduce = useReducedMotion();
  const tone = badge.tone || hashTone(badge.id);
  const state = locked ? 'locked' : badge.earned ? 'earned' : 'in-progress';
  const style = {
    width: size,
    height: size,
    '--tag-color': `var(--tag-${tone})`,
    '--tag-ink': `var(--tag-${tone}-ink)`,
  };
  // Only a freshly-earned badge pops in — everything else (already-earned,
  // in-progress, locked) renders exactly as before, `initial={false}`
  // skipping any mount animation entirely. A badge you unlocked days ago
  // shouldn't replay its entrance every time you revisit this page; only
  // the ones still carrying the "New" ribbon get the moment.
  const celebrate = isNew && !reduce;
  return (
    <motion.div
      className="badge-ring"
      data-state={state}
      style={style}
      initial={celebrate ? { scale: 0.4, opacity: 0, filter: 'blur(4px)' } : false}
      animate={celebrate ? { scale: 1, opacity: 1, filter: 'blur(0px)' } : undefined}
      transition={{ type: 'spring', duration: 0.5, bounce: 0.3 }}
    >
      {state === 'earned' && (
        <span className="badge-sprite-icon" style={{ backgroundPosition: badgeSpritePosition(badge.id) }} />
      )}
      {state === 'locked' && <IconLock className="badge-lock" />}
      {isNew && <span className="badge-new-ribbon">New</span>}
      <span className="visually-hidden">
        {badge.name}: {badge.description}
        {locked ? ' (undiscovered)' : badge.earned ? ' (earned)' : ` (${badge.progress}/${badge.target})`}
      </span>
    </motion.div>
  );
}

function BadgesMobile({ earned, inProgress, undiscovered, newIds }) {
  return (
    <>
      <TopBar title="Badges" />

      {earned.length > 0 ? (
        <div className="badges-earned-row">
          {earned.map((b) => (
            <BadgeRing key={b.id} badge={b} size={74} isNew={newIds.has(b.id)} />
          ))}
        </div>
      ) : (
        <p className="data-stat" style={{ marginBottom: 18 }}>No badges yet — your first quest starts the collection.</p>
      )}

      {inProgress.length > 0 && (
        <>
          <div className="badge-section-pill">In progress</div>
          <div className="badges-grid">
            {inProgress.map((b) => (
              <BadgeRing key={b.id} badge={b} size={70} />
            ))}
          </div>
        </>
      )}

      {undiscovered.length > 0 && (
        <>
          <div className="badge-section-pill" data-tone="muted">Undiscovered</div>
          <div className="badges-grid">
            {undiscovered.map((b) => (
              <BadgeRing key={b.id} badge={b} size={70} locked />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function BadgesDesktop({ earned, inProgress, undiscovered, newIds }) {
  return (
    <>
      <div className="page-greeting">
        <h1>Badges</h1>
      </div>

      <section className="ink-card" style={{ marginBottom: 16 }}>
        <p className="badge-section-title">Earned</p>
        {earned.length > 0 ? (
          <div className="badges-desktop-row">
            {earned.map((b) => (
              <BadgeRing key={b.id} badge={b} size={78} isNew={newIds.has(b.id)} />
            ))}
          </div>
        ) : (
          <p className="data-stat" style={{ margin: 0 }}>No badges yet — your first quest starts the collection.</p>
        )}
      </section>

      {inProgress.length > 0 && (
        <section className="ink-card" style={{ marginBottom: 16 }}>
          <p className="badge-section-title">In progress</p>
          <div className="badges-desktop-row">
            {inProgress.map((b) => (
              <BadgeRing key={b.id} badge={b} size={78} />
            ))}
          </div>
        </section>
      )}

      {undiscovered.length > 0 && (
        <section className="ink-card" data-muted="true">
          <p className="badge-section-title">Undiscovered</p>
          <div className="badges-desktop-row">
            {undiscovered.map((b) => (
              <BadgeRing key={b.id} badge={b} size={78} locked />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export function Badges() {
  const { user } = useAuth();
  const [badges, setBadges] = useState(null);
  const [newIds, setNewIds] = useState(() => new Set());
  const isDesktop = useIsDesktop();
  const previousPath = usePreviousPath();
  const previousLabel = labelForPath(previousPath);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([
      getDocs(collection(db, 'quests')),
      getDocs(query(collection(db, 'attendance'), where('userId', '==', user.uid))),
      getDoc(doc(db, 'users', user.uid)),
    ]).then(([questsSnap, attendanceSnap, userSnap]) => {
      if (cancelled) return;
      const questsById = new Map(questsSnap.docs.map((d) => [d.id, d.data()]));
      const attendance = attendanceSnap.docs.map((d) => d.data());
      const userData = userSnap.exists() ? userSnap.data() : {};

      const computed = computeBadges({
        attendance,
        questsById,
        rank: userData.rank,
        createdAt: userData.createdAt,
      });
      setBadges(computed);

      // A badge is "new" if it's earned but hasn't been marked seen yet
      // anywhere — localStorage (this browser) or the user doc (any
      // device). Once shown, mark it seen in both places so the ribbon
      // doesn't come back.
      const alreadySeen = new Set([...getLocallySeenBadgeIds(), ...(userData.seenBadgeIds || [])]);
      const freshlyEarnedIds = computed.filter((b) => b.earned && !alreadySeen.has(b.id)).map((b) => b.id);
      if (freshlyEarnedIds.length > 0) {
        setNewIds(new Set(freshlyEarnedIds));
        markBadgesSeenLocally(freshlyEarnedIds);
        callMarkBadgesSeen(freshlyEarnedIds).catch(() => {
          // Non-critical — worst case the ribbon reappears once more on a
          // later visit if this retry never lands.
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!badges) return <LoadingSpinner label="Loading badges…" />;

  const earned = badges.filter((b) => b.earned);
  const inProgress = badges.filter((b) => !b.earned && b.started);
  const undiscovered = badges.filter((b) => !b.started);

  return (
    <PageMotion>
      <BackLink
        to={previousLabel ? previousPath : '/profile'}
        label={previousLabel || 'Profile'}
      />
      {isDesktop ? (
        <BadgesDesktop earned={earned} inProgress={inProgress} undiscovered={undiscovered} newIds={newIds} />
      ) : (
        <BadgesMobile earned={earned} inProgress={inProgress} undiscovered={undiscovered} newIds={newIds} />
      )}
    </PageMotion>
  );
}
