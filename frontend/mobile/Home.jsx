import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@shared/AuthContext.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { DuckMark } from '@shared/Logo.jsx';
import { pointsToNextRank, progressPercent, rankForPoints } from '@shared/rank.js';

// The new landing screen for the `user` role (see BottomNav's PRIMARY_BY_ROLE
// and App.jsx's PublicHome) — a quick greeting/rank teaser plus the two
// actions the wireframe called out (search a quest, check in), rather than
// dropping someone straight into the quest feed. The full rank breakdown
// still lives on Profile (see ProgressCard there); this is deliberately just
// the "X to next rank" line, not the whole milestone row.
export function Home() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      const data = snap.exists() ? snap.data() : {};
      setProfile({ name: data.name || '', points: data.points || 0 });
    });
  }, [user]);

  if (profile === null) return <LoadingSpinner label="Loading..." />;

  const firstName = profile.name ? profile.name.split(' ')[0] : null;
  const rank = rankForPoints(profile.points);
  const toNext = pointsToNextRank(profile.points);
  const percent = progressPercent(profile.points);

  return (
    <div className="home-page">
      <div className="home-greeting">
        <DuckMark size={140} />
        <h1>{firstName ? `Hello, ${firstName}` : 'Hello!'}</h1>
      </div>

      {/* The greeting above is deliberately card-free (mascot + name sit
          right on the page background) — but the progress bar needs enough
          contrast to actually read as a bar, so it keeps its own small card
          rather than floating on the same plain background. */}
      <div className="ink-card home-progress-card">
        <p className="data-stat" style={{ margin: 0 }}>
          {toNext !== null ? `${toNext} points to next rank!` : `Top rank reached — ${rank}!`}
        </p>
        <div className="rank-progress-track" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
          <div className="rank-progress-fill" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="home-actions flex flex-col gap-md">
        <Link to="/quests">
          <StampButton type="button" variant="primary" style={{ width: '100%' }}>
            Search a quest!
          </StampButton>
        </Link>
        <Link to="/check-in">
          <StampButton type="button" style={{ width: '100%' }}>
            Check in
          </StampButton>
        </Link>
      </div>
    </div>
  );
}
