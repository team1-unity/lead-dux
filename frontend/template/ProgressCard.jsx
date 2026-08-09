import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from './AuthContext.jsx';
import { db } from './firebaseapp.jsx';
import { StampButton } from './StampButton.jsx';
import { IconCheck, IconLock } from './icons.jsx';
import { allRanks, pointsToNextRank, progressPercent, rankForPoints } from './rank.js';

// The full leadership-rank picture: rank name, points, progress bar, the
// whole milestone ladder, and a Diamond-certificate banner once earned —
// moved here from Profile.jsx (its original home) onto Home.jsx instead,
// as the first thing a "user" role sees when they land, rather than
// tucked away on the Profile page. Points/rank/certificateIssued are read
// straight off the user's own doc (self-readable, see firestore.rules) —
// no dedicated Cloud Function needed just to display them. Rank itself IS
// stored server-side too (kept in sync by functions/main.py's
// _award_points, see rank.js for why it's still recomputed here rather
// than trusted blindly). Always fully shown — no expand/collapse toggle;
// points/progress bar/milestones are as much "who I am" as the rank name
// itself, so there's no reason to hide them behind a tap.
//
// `profile` is optional — Profile.jsx and Quests.jsx don't pass one, so
// this fetches for itself exactly as before. Home.jsx does pass one: it
// already holds a live users/{uid} listener for the greeting (name/
// duckSkin), and without this, ProgressCard was independently re-reading
// that exact same document on the single most-visited screen in the app.
export function ProgressCard({ profile: profileProp }) {
  const { user } = useAuth();
  const [fetchedProfile, setFetchedProfile] = useState(null);

  useEffect(() => {
    if (profileProp || !user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      const data = snap.exists() ? snap.data() : {};
      setFetchedProfile({ points: data.points || 0, certificateIssued: Boolean(data.certificateIssued) });
    });
  }, [user, profileProp]);

  const profile = profileProp || fetchedProfile;
  if (profile === null) return null;

  const { points, certificateIssued } = profile;
  const rank = rankForPoints(points);
  const toNext = pointsToNextRank(points);
  const percent = progressPercent(points);
  const rankOrder = allRanks();
  const currentIndex = rankOrder.indexOf(rank);

  return (
    <section className='ink-card' style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        className='quest-card-titles'
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
        }}
      >
        <h2 style={{ marginBottom: 0 }}>
          Leadership Rank
          <span style={{ fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}>
            {' '}
            — {rank}
          </span>
        </h2>
        <p className='data-stat' style={{ margin: 0, flex: 'none' }}>
          {toNext !== null ? `${toNext} to ${rankForPoints(points + toNext)}` : 'Top rank reached'}
        </p>
      </div>

      <div
        className='rank-progress-track'
        role='progressbar'
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className='rank-progress-fill' style={{ width: `${percent}%` }} />
      </div>

      <div className='rank-milestones'>
        {rankOrder.map((name, i) => {
          const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'locked';
          const tone = name.toLowerCase();
          return (
            <div className='rank-milestone' key={name} data-state={state}>
              <span
                className='rank-milestone-dot'
                style={{
                  '--rank-color': `var(--rank-${tone})`,
                  '--rank-ink': `var(--rank-${tone}-ink)`,
                }}
              >
                {state === 'done' && <IconCheck width={14} height={14} />}
                {state === 'locked' && <IconLock width={14} height={12} />}
              </span>
              <span className='rank-milestone-label'>{name}</span>
            </div>
          );
        })}
      </div>

      {certificateIssued && (
        <div className='rank-certificate-banner'>
          <p style={{ margin: 0 }}>You&rsquo;ve been awarded a Diamond leadership certificate!</p>
          <Link to='/certificate'>
            <StampButton type='button' variant='primary'>
              View certificate
            </StampButton>
          </Link>
        </div>
      )}
    </section>
  );
}
