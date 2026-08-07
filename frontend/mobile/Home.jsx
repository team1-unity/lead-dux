import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc, getDocs, onSnapshot, collection, limit, query, where } from 'firebase/firestore';
import { useAuth } from '@shared/AuthContext.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { ProgressCard } from '@shared/ProgressCard.jsx';
import { NotificationBanner } from '@shared/NotificationBanner.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { IconQrCode, IconList, IconHistory } from '@shared/icons.jsx';
import { duckSkinSrc } from '@shared/duckSkins.js';

// A small rotating set rather than one fixed line — Home is the one screen
// in the app someone opens several times a day, so a single static caption
// under the duck would go stale fast. Picked by day-of-month rather than
// per-render, so it stays put for the whole day instead of changing on
// every navigation back to this screen.
const HOME_CAPTIONS = [
  'Ready when you are.',
  "Let's find you something today.",
  'Your community is waiting.',
  'One quest a day adds up fast.',
  "Somewhere out there needs a leader today — maybe that's you.",
];
function homeCaption() {
  return HOME_CAPTIONS[new Date().getDate() % HOME_CAPTIONS.length];
}

function toMillis(value) {
  return (value.toDate ? value.toDate() : new Date(value)).getTime();
}

// A floating quick-actions HUD, not inline buttons. Mobile: a deliberate
// game-UI treatment (bordered slot, hard offset shadow, lift-on-hover)
// rather than this app's usual flat StampButton, icon-only and stacked in
// the top-right corner. Desktop: a plain list panel instead — icon +
// label rows divided by hairlines, floating along the right edge (see
// .home-quick-action in style.css for the breakpoint). "My quests" only
// appears once there's an actual RSVP'd quest to jump to (see
// useHasRsvpdQuest above); "Last quest" only once there's a past quest to
// revisit (see useLastAttendedQuest above) — an empty destination isn't
// worth a slot on a HUD this small.
function HomeQuickActions({ hasRsvpd, lastAttended }) {
  const actions = [
    { to: '/check-in', icon: IconQrCode, label: 'Check in' },
    ...(hasRsvpd ? [{ to: '/quests?view=mine', icon: IconList, label: 'My quests' }] : []),
    ...(lastAttended
      ? [{ to: '/quests?view=past', icon: IconHistory, label: 'Last quest' }]
      : []),
  ];

  return (
    <nav className="home-quick-actions" aria-label="Quick actions">
      {actions.map((a) => (
        <Link key={a.to} to={a.to} className="home-quick-action" aria-label={a.label} title={a.label}>
          <span className="home-quick-action-icon">
            <a.icon />
          </span>
          <span className="home-quick-action-label">{a.label}</span>
        </Link>
      ))}
    </nav>
  );
}

// A quick way back to the quest someone most recently checked into —
// scanned client-side rather than an orderBy('checkedInAt') query, since
// one leader's own attendance history is small enough that a composite
// index just for this isn't worth it (same reasoning
// _completed_feedback_requests_this_month in functions/main.py already
// uses for a similarly-bounded per-user query). Links to the Explore
// Quests list with Past Attended pre-selected (see Quests.jsx's
// initialView), not straight to this one quest's own page — a past
// quest's standalone /quests/:seriesId page has nothing left to do (no
// RSVP, no upcoming date), and Past Attended already sorts most-recent
// first, so browsing from there surfaces this same quest first anyway
// while still letting someone explore other past ones instead.
function useLastAttendedQuest(user) {
  const [quest, setQuest] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    getDocs(query(collection(db, 'attendance'), where('userId', '==', user.uid)))
      .then((snap) => {
        if (cancelled || snap.empty) return null;
        const latest = snap.docs
          .map((d) => d.data())
          .reduce((a, b) => (toMillis(a.checkedInAt) > toMillis(b.checkedInAt) ? a : b));
        return getDoc(doc(db, 'quests', latest.eventId));
      })
      .then((questSnap) => {
        if (!cancelled && questSnap?.exists()) {
          setQuest({ title: questSnap.data().title });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  return quest;
}

// Whether "My quests" (quest.rsvpd array-contains the caller — same field
// Quests.jsx's own view=mine filter checks, see its activity==='mine'
// branch) has anything to show at all — null while loading, so the quick-
// actions HUD doesn't flash the button on then immediately hide it once
// this resolves to false.
function useHasRsvpdQuest(user) {
  const [hasRsvpd, setHasRsvpd] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    getDocs(query(collection(db, 'quests'), where('rsvpd', 'array-contains', user.uid), limit(1)))
      .then((snap) => {
        if (!cancelled) setHasRsvpd(!snap.empty);
      })
      .catch(() => {
        if (!cancelled) setHasRsvpd(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return hasRsvpd;
}

// The new landing screen for the `user` role (see BottomNav's PRIMARY_BY_ROLE
// and App.jsx's PublicHome) — a quick greeting plus Check in (the
// wireframe's other primary action, search a quest, is one tap away via
// BottomNav's own Quests tab, so it's not duplicated here), plus quick
// links into two of Explore Quests' own filters (your RSVP'd quests
// always; revisit past quests only once there's actually a past quest to
// revisit) rather than dropping someone straight into the quest feed.
// Rank progress is ProgressCard (@shared/ProgressCard.jsx — moved here
// from Profile.jsx, its original home) — the full rank card (name,
// points, progress bar, milestone ladder, certificate banner), not the
// lighter RankProgressCard teaser mobile/Quests.jsx's pending_org banner
// still uses. It's the first thing a "user" role sees now, rather than
// tucked away on their Profile page.
export function Home() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const lastAttended = useLastAttendedQuest(user);
  const hasRsvpd = useHasRsvpdQuest(user);

  // A live listener, not a one-time getDoc — Edit Profile is reachable two
  // ways: Profile.jsx's own button (navigates through /profile, so Home
  // remounts fresh and a one-time fetch would've been enough) and
  // BottomNav's avatar dropdown (opens the same modal as an overlay on top
  // of whichever page is already showing, Home included, with no
  // navigation at all). Saving a new duck skin from that second path never
  // touched this already-mounted component's own state, so the greeting
  // kept showing the old duck until the next full remount. A live
  // subscription picks up either path the moment the write lands.
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const data = snap.exists() ? snap.data() : {};
      setProfile({ name: data.name || '', duckSkin: data.duckSkin || null });
    });
  }, [user]);

  if (profile === null) return <LoadingSpinner label="Loading…" />;

  const firstName = profile.name ? profile.name.split(' ')[0] : null;

  return (
    <>
      {/* Outside PageMotion deliberately — PageMotion's motion.div always
          carries a `filter` value (even blur(0px) at rest, see
          PageMotion.jsx), and any filter (like transform) establishes a
          new containing block for position:fixed descendants. Nested
          inside it, this HUD would anchor to PageMotion's own narrow
          centered box instead of the true viewport edge. */}
      <HomeQuickActions hasRsvpd={hasRsvpd} lastAttended={lastAttended} />
      {/* Also outside PageMotion, for a related but distinct reason: that
          same always-on transform/filter doesn't just move this HUD's
          containing block, it also makes PageMotion's own div a brand new
          stacking context. A child's z-index (however high) only ever
          ranks it against siblings *inside* that same context — it can't
          reach out and outrank a sibling of the transformed ancestor
          itself. Nested in PageMotion, this banner's z-index: 20 (see
          .notification-banner) was being silently capped there, so
          .home-quick-actions' own position:fixed + z-index: 5 (a sibling
          of PageMotion, not a descendant) still painted over it whenever
          they overlapped — the exact trap LightboxBackdrop.jsx's own
          module comment describes for this same PageMotion transform.
          Rendering as PageMotion's sibling instead sidesteps the nested
          context entirely, the same fix already applied to
          HomeQuickActions above. */}
      <NotificationBanner />
      <PageMotion className="home-page">
        <div className='home-greeting'>
          <img src={duckSkinSrc(profile.duckSkin)} alt="" className="home-greeting-duck" />
          <h1>{firstName ? `Hello, ${firstName}` : 'Hello!'}</h1>
          <p className="duck-caption">{homeCaption()}</p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <ProgressCard />
        </div>
      </PageMotion>
    </>
  );
}
