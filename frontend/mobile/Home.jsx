import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@shared/AuthContext.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { DuckMark } from '@shared/Logo.jsx';
import { RankProgressCard } from '@shared/RankProgressCard.jsx';

// The new landing screen for the `user` role (see BottomNav's PRIMARY_BY_ROLE
// and App.jsx's PublicHome) — a quick greeting plus the two actions the
// wireframe called out (search a quest, check in), rather than dropping
// someone straight into the quest feed. Rank progress is RankProgressCard
// (shared with mobile/Quests.jsx on main) — this used to be its own
// one-line "X to next rank" teaser here, but the full card (rank name,
// points, and the same progress bar) reads better than a teaser when it's
// already the first thing on the page, and it's one less rank-derivation
// implementation to keep in sync. Profile's own ProgressCard is unaffected
// (full milestone ladder + certificate banner, out of scope here).
export function Home() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      const data = snap.exists() ? snap.data() : {};
      setProfile({ name: data.name || '' });
    });
  }, [user]);

  if (profile === null) return <LoadingSpinner label="Loading..." />;

  const firstName = profile.name ? profile.name.split(' ')[0] : null;

  return (
    <div className="home-page">
      <div className="home-greeting">
        <DuckMark size={140} />
        <h1>{firstName ? `Hello, ${firstName}` : 'Hello!'}</h1>
      </div>

      <div style={{ marginBottom: 16 }}>
        <RankProgressCard />
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
