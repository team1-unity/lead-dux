import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from './AuthContext.jsx';
import { db } from './firebaseapp.jsx';
import { pointsToNextRank, progressPercent, rankForPoints } from './rank.js';

// Rank name, points, and the progress bar toward the next rank — the
// glanceable core of Profile.jsx's ProgressCard (which also shows the
// full milestone ladder and a Diamond-certificate banner), pulled out
// here so mobile/Quests.jsx can show the same numbers right on the home
// screen without duplicating the rank-derivation JSX in two files.
//
// `points` is optional — pass it when the caller already has it on hand
// (Profile.jsx's ProgressCard fetches points itself anyway, for the
// milestone ladder's current-rank highlighting, so it passes that same
// value down instead of triggering a second read of the same doc).
// Callers with no reason to load it themselves (mobile/Quests.jsx) can
// omit the prop and this fetches users/{uid} on its own.
export function RankProgressCard({ points: pointsProp }) {
  const { user } = useAuth();
  const [fetchedPoints, setFetchedPoints] = useState(null);

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
    <section className="ink-card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
    </section>
  );
}
