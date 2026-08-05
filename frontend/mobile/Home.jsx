import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { useAuth } from '@shared/AuthContext.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { DuckMark } from '@shared/Logo.jsx';
import { ProgressCard } from '@shared/ProgressCard.jsx';
import { NotificationBanner } from '@shared/NotificationBanner.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';

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

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      const data = snap.exists() ? snap.data() : {};
      setProfile({ name: data.name || '' });
    });
  }, [user]);

  if (profile === null) return <LoadingSpinner label="Loading…" />;

  const firstName = profile.name ? profile.name.split(' ')[0] : null;

  return (
    <PageMotion className="home-page">
      <NotificationBanner />

      <div className='home-greeting'>
        <DuckMark size={140} />
        <h1>{firstName ? `Hello, ${firstName}` : 'Hello!'}</h1>
        <p className="duck-caption">{homeCaption()}</p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <ProgressCard />
      </div>

      <div className='home-actions flex flex-col gap-md'>
        <Link to='/check-in'>
          <StampButton type='button' variant='primary' style={{ width: '100%' }}>
            Check in
          </StampButton>
        </Link>
        <Link to='/quests?view=mine'>
          <StampButton type='button' style={{ width: '100%' }}>
            My quests
          </StampButton>
        </Link>
        {lastAttended && (
          <Link to='/quests?view=past'>
            <StampButton type='button' style={{ width: '100%' }}>
              Last quest
            </StampButton>
          </Link>
        )}
      </div>
    </PageMotion>
  );
}
