import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { callRsvpToQuest, callCancelRsvp } from '@shared/fetch.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { DuckMark } from '@shared/Logo.jsx';
import { isUpcoming } from '@shared/questSeries.js';
import { QuestDetailBody } from '@mobile/Quests.jsx';

// The page a "Share Quest" link (QuestSeriesRow's org-dashboard action)
// actually points at — the one route in this app that works fully signed
// out, so a link dropped into a social post or QR code works for someone
// who's never made an account. Deliberately fetches by plain getDoc, a
// single-document read firestore.rules allows to anyone (quests/{questId}'s
// `allow get: if true`), not the `where('seriesId', ...)` query
// QuestDetails.jsx uses for the signed-in version of this page (that's
// `allow list`, still auth-only, to keep the whole catalog from being
// publicly browsable) — so a shared link to a *recurring* series shows
// just the specific occurrence it was generated from, not the full
// calendar of that series' other dates. Signing in reveals the rest via
// the normal browsing flow.
export function SharedQuest() {
  const { seriesId } = useParams();
  const navigate = useNavigate();
  const { user, role, loading: authLoading } = useAuth();
  const [quest, setQuest] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [busyId, setBusyId] = useState(null);

  function load() {
    getDoc(doc(db, 'quests', seriesId)).then((snap) => {
      if (!snap.exists()) {
        setNotFound(true);
        return;
      }
      setQuest({ id: snap.id, ...snap.data() });
    });
  }

  useEffect(load, [seriesId]);

  async function toggleRsvp(q) {
    setBusyId(q.id);
    try {
      if ((q.rsvpd || []).includes(user.uid)) {
        await callCancelRsvp(q.id);
      } else {
        await callRsvpToQuest(q.id);
      }
      load();
    } finally {
      setBusyId(null);
    }
  }

  if (authLoading || (!quest && !notFound)) return <LoadingSpinner label="Loading quest…" />;

  // Covers both "unpublished/inactive" cases a shared link can point at —
  // the quest doc no longer exists (deleted) or it does but its event
  // window has already passed (isUpcoming, the same rule browsing already
  // hides expired quests by) — neither shows quest details to a visitor.
  if (notFound) {
    return (
      <PageMotion>
        <div className="ink-card shared-quest-message">
          <DuckMark size={56} />
          <h1>This link isn't valid anymore</h1>
          <p>The quest it points to has been removed.</p>
          <StampButton as={Link} to="/" variant="primary">
            Go to Leadership Quest
          </StampButton>
        </div>
      </PageMotion>
    );
  }

  // Side/default quests never had a "Share quest" action to generate this
  // link from (see QuestSeriesRow.jsx, gated on primary.orgId) — guarding
  // here too means an already-shared or bookmarked link to one stops
  // working, not just the button that would create a new one.
  if (!quest.orgId) {
    return (
      <PageMotion>
        <div className="ink-card shared-quest-message">
          <DuckMark size={56} />
          <h1>This link isn't available</h1>
          <p>Side quests don't have their own individual share link.</p>
          <StampButton as={Link} to="/" variant="primary">
            Go to Leadership Quest
          </StampButton>
        </div>
      </PageMotion>
    );
  }

  if (!isUpcoming(quest)) {
    return (
      <PageMotion>
        <div className="ink-card shared-quest-message">
          <DuckMark size={56} />
          <h1>{quest.title}</h1>
          <p>This quest has already happened and is no longer accepting participants.</p>
          <StampButton as={Link} to="/" variant="primary">
            Find other quests
          </StampButton>
        </div>
      </PageMotion>
    );
  }

  const series = { seriesId, occurrences: [quest], primary: quest };

  return (
    <PageMotion>
      <div className="ink-card">
        <QuestDetailBody
          series={series}
          userId={user?.uid}
          canRsvp={role === 'user'}
          busyId={busyId}
          onToggleRsvp={toggleRsvp}
          // Signed out entirely (no account at all) — pressing what looks
          // like the normal RSVP button sends them to create one instead,
          // rather than showing a separate "sign up to RSVP" box below an
          // otherwise inert card. Anyone signed in (even mid-onboarding, or
          // an org/admin) already gets the normal canRsvp=false treatment
          // elsewhere in the app, so this stays scoped to true guests.
          onGuestRsvp={!user ? () => navigate('/register') : undefined}
          showTitle
        />
      </div>
      {!user && (
        <p className="shared-quest-login-hint">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      )}
    </PageMotion>
  );
}
