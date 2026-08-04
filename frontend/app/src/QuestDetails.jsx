import { useEffect, useState } from 'react';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { callRsvpToQuest, callCancelRsvp, callGetSideQuestStatus } from '@shared/fetch.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { BackLink } from '@shared/BackLink.jsx';
import { groupBySeries, attachSeriesRatings } from '@shared/questSeries.js';
import { QuestDetailBody, sideQuestGate } from '@mobile/Quests.jsx';

// A standalone page for one quest series, reusing the exact same
// QuestDetailBody the main Quests page shows inline — this is what
// Organization Profile's "Active Quests" cards (and anything else that
// wants to link straight to a specific quest) point at, rather than a
// deep link back into the browsing list.
export function QuestDetails() {
  const { seriesId } = useParams();
  const navigate = useNavigate();
  const { user, role, loading } = useAuth();
  const [series, setSeries] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [busyId, setBusyId] = useState(null);
  // Side-quest tier-lock/concurrent-limit status — mobile/Quests.jsx's own
  // browsing list already fetches this to gray out the RSVP button and
  // swap its label to "Locked"/"Limit reached"; this standalone page (what
  // mobile navigates to instead of expanding a row inline) never fetched
  // it at all, so a gated side quest showed a fully-enabled "Accept Quest"
  // button here regardless of tier/limit — desktop's inline pane never had
  // this gap since it always went through the browsing list's own fetch.
  const [sideQuestStatus, setSideQuestStatus] = useState(null);

  function load() {
    Promise.all([
      getDocs(query(collection(db, 'quests'), where('seriesId', '==', seriesId))),
      getDoc(doc(db, 'questSeries', seriesId)),
    ]).then(([questsSnap, seriesAggSnap]) => {
      const quests = questsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (quests.length === 0) {
        setNotFound(true);
        return;
      }
      const seriesDocsById = new Map([[seriesId, seriesAggSnap.exists() ? seriesAggSnap.data() : {}]]);
      const [grouped] = attachSeriesRatings(groupBySeries(quests), seriesDocsById);
      setSeries(grouped);
    });
  }

  useEffect(load, [seriesId]);

  useEffect(() => {
    if (role !== 'user') return;
    callGetSideQuestStatus().then(setSideQuestStatus).catch(() => {});
  }, [role]);

  async function toggleRsvp(quest) {
    setBusyId(quest.id);
    try {
      if ((quest.rsvpd || []).includes(user.uid)) {
        await callCancelRsvp(quest.id);
      } else {
        await callRsvpToQuest(quest.id);
      }
      load();
      if (role === 'user') callGetSideQuestStatus().then(setSideQuestStatus).catch(() => {});
    } finally {
      setBusyId(null);
    }
  }

  if (notFound) return <Navigate to="/" replace />;
  // On a hard reload, Firebase Auth hasn't resolved `user` yet even after
  // this quest's own (auth-independent) fetch finishes — render below reads
  // user.uid unconditionally, so this has to wait on both, not just
  // `series`, or it crashes here specifically (a client-side nav never hit
  // this because `user` is already warm by the time this page mounts).
  if (loading || !series) return <LoadingSpinner label="Loading quest…" />;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <PageMotion>
      <BackLink to="/quests" label="Quests" />
      <div className="ink-card">
        <QuestDetailBody
          series={series}
          userId={user.uid}
          canRsvp={role === 'user'}
          busyId={busyId}
          onToggleRsvp={toggleRsvp}
          gate={sideQuestGate(series.primary, sideQuestStatus)}
          onGoToOrgQuests={() => navigate('/quests')}
          showTitle
        />
      </div>
    </PageMotion>
  );
}
