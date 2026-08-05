import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from './AuthContext.jsx';
import { db } from './firebaseapp.jsx';
import { pointsToNextRank, progressPercent, rankForPoints } from './rank.js';

// Rank name, points, and the progress bar toward the next rank — the
// glanceable core of @shared/ProgressCard.jsx (which also shows the full
// milestone ladder and a Diamond-certificate banner; that one lives on
// Home.jsx now, see its own comment there), pulled out here for
// mobile/Quests.jsx's pending_org banner, which just wants the quick
// numbers without duplicating the rank-derivation JSX in two files.
//
// `points` is optional — pass it when the caller already has it on hand.
// Callers with no reason to load it themselves (mobile/Quests.jsx) can
// omit the prop and this fetches users/{uid} on its own.
export function RankProgressCard({ points: pointsProp }) {
  const { user } = useAuth();
  const [fetchedPoints, setFetchedPoints] = useState(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (pointsProp !== undefined || !user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      setFetchedPoints(snap.exists() ? snap.data().points || 0 : 0);
    });
  }, [user, pointsProp]);

  const points = pointsProp !== undefined ? pointsProp : fetchedPoints;
  if (points === null) return null;

  const rank = rankForPoints(points);
  const toNext = pointsToNextRank(points);
  const percent = progressPercent(points);

  return (
    // This mounts the moment its own async fetch resolves, well after
    // PageMotion's page-shell transition has already finished — without
    // its own initial/animate here, the numbers would just pop into
    // existence with no transition at all once the network response lands.
    <motion.section
      className="ink-card"
      style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
      initial={reduce ? false : { opacity: 0, y: 8, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
    >
      <h2 style={{ marginBottom: 0 }}>Leadership Progress</h2>
      <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.4rem', textTransform: 'uppercase' }}>
        {rank}
      </p>
      <p className="data-stat" style={{ marginTop: 4 }}>
        {points} point{points === 1 ? '' : 's'}
        {toNext !== null ? ` — ${toNext} to ${rankForPoints(points + toNext)}` : ' — top rank reached'}
      </p>

      <div className="rank-progress-track" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
        <div className="rank-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </motion.section>
  );
}
