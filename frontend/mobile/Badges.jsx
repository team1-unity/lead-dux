import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { useIsDesktop } from '@shared/useIsDesktop.js';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { computeBadges } from '@shared/badges.js';
import { hashTone } from '@shared/tagTones.js';
import { getInitials } from '@shared/initials.js';
import { IconHeart, IconLock } from '@shared/icons.jsx';

// A single badge's ring — earned (tag-tinted fill + heart), in-progress
// (plain ring), or undiscovered (locked, muted fill). The name/description
// only ever reaches the DOM as visually-hidden text: the wireframe this
// screen matches is deliberately iconography-only, but a screen reader user
// still needs to know what each circle means.
function BadgeRing({ badge, size, locked = false }) {
  const tone = badge.tone || hashTone(badge.id);
  const state = locked ? 'locked' : badge.earned ? 'earned' : 'in-progress';
  const style = {
    width: size,
    height: size,
    '--tag-color': `var(--tag-${tone})`,
    '--tag-ink': `var(--tag-${tone}-ink)`,
  };
  return (
    <div className="badge-ring" data-state={state} style={style}>
      {state === 'earned' && <IconHeart className="badge-heart" />}
      {state === 'locked' && <IconLock className="badge-lock" />}
      <span className="visually-hidden">
        {badge.name}: {badge.description}
        {locked ? ' (undiscovered)' : badge.earned ? ' (earned)' : ` (${badge.progress}/${badge.target})`}
      </span>
    </div>
  );
}

// A compact white header bar (title + circular avatar) rather than the
// plain page-greeting other mobile screens use — matches the reference
// look for this screen specifically. The negative margin pulls it flush to
// the viewport edges, undoing #root's own padding just for this bar.
function BadgesMobileHeader({ displayName }) {
  return (
    <div className="mobile-page-header">
      <h1>Badges</h1>
      <Link
        to="/profile"
        className="nav-avatar"
        aria-label="Profile"
        title="Profile"
        style={{ width: 36, height: 36, fontSize: '0.78rem' }}
      >
        {getInitials(displayName)}
      </Link>
    </div>
  );
}

function BadgesMobile({ earned, inProgress, undiscovered, displayName }) {
  return (
    <>
      <BadgesMobileHeader displayName={displayName} />

      {earned.length > 0 ? (
        <div className="badges-earned-row">
          {earned.map((b) => (
            <BadgeRing key={b.id} badge={b} size={74} />
          ))}
        </div>
      ) : (
        <p className="data-stat" style={{ marginBottom: 18 }}>No badges earned yet — RSVP to a quest to get started.</p>
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

function BadgesDesktop({ earned, inProgress, undiscovered }) {
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
              <BadgeRing key={b.id} badge={b} size={78} />
            ))}
          </div>
        ) : (
          <p className="data-stat" style={{ margin: 0 }}>No badges earned yet — RSVP to a quest to get started.</p>
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
  const [displayName, setDisplayName] = useState(null);
  const isDesktop = useIsDesktop();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getDocs(collection(db, 'quests')).then((snap) => {
      if (cancelled) return;
      const quests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setBadges(computeBadges(quests, user.uid));
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Only needed for the mobile header's avatar initials — desktop gets its
  // own avatar from BottomNav.
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      if (snap.exists()) setDisplayName(snap.data().name || '');
    });
  }, [user]);

  if (!badges) return <LoadingSpinner label="Loading badges..." />;

  const earned = badges.filter((b) => b.earned);
  const inProgress = badges.filter((b) => !b.earned && b.started);
  const undiscovered = badges.filter((b) => !b.started);

  return (
    <PageMotion>
      {isDesktop ? (
        <BadgesDesktop earned={earned} inProgress={inProgress} undiscovered={undiscovered} />
      ) : (
        <BadgesMobile earned={earned} inProgress={inProgress} undiscovered={undiscovered} displayName={displayName} />
      )}
    </PageMotion>
  );
}
