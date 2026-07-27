import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { TopBar } from '@shared/TopBar.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { PendingFeedbackRequests } from '@shared/PendingFeedbackRequests.jsx';

// Mirrors FEEDBACK_QUESTIONS in functions/main.py and
// PendingFeedbackRequests.jsx by hand, same as every other copy of this
// ladder kept in sync across the app.
const FEEDBACK_QUESTIONS = {
  engagement: 'How actively did they participate and engage during the quest?',
  presence: 'How present and attentive were they throughout?',
  involvement: 'How involved were they in contributing to the group or task?',
  initiative: 'How much initiative did they show — stepping up or helping without being asked?',
  attitude: 'How positive and cooperative was their attitude?',
};

function toDate(value) {
  return value.toDate ? value.toDate() : new Date(value);
}

// A read-only look back at feedback this org has already given — completed
// feedbackRequests docs already carry everything needed (see
// submit_feedback_request_response in functions/main.py), so no new
// backend support was required, just this query. The requesting member's
// name isn't denormalized onto the request doc, so it's resolved with one
// extra read per entry — fine at this app's scale (same tradeoff several
// other lists here already make).
function FeedbackHistory({ orgId }) {
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getDocs(
      query(
        collection(db, 'feedbackRequests'),
        where('status', '==', 'completed'),
        where('orgId', '==', orgId),
      ),
    ).then(async (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => toDate(b.completedAt).getTime() - toDate(a.completedAt).getTime());
      const withNames = await Promise.all(
        rows.map(async (r) => {
          const userSnap = await getDoc(doc(db, 'users', r.uid));
          return { ...r, memberName: userSnap.exists() ? userSnap.data().name : null };
        }),
      );
      if (!cancelled) setEntries(withNames);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (entries === null) return <LoadingSpinner label='Loading feedback history...' />;

  return (
    <section>
      <h2>Feedback you&rsquo;ve given</h2>
      {entries.length === 0 ? (
        <p>You haven&rsquo;t answered any feedback requests yet.</p>
      ) : (
        <div className='ink-card data-list'>
          {entries.map((entry) => (
            <div key={entry.id} className='data-row'>
              <div className='data-row-head'>
                <p className='data-row-title'>{entry.memberName || 'Unnamed'}</p>
                <span className='data-stat'>{entry.questTitle}</span>
              </div>
              <p className='data-row-sub'>Overall score: {entry.score}/10</p>
              <ul className='data-sublist'>
                {Object.entries(FEEDBACK_QUESTIONS).map(([key, question]) => (
                  <li key={key}>
                    {question} — <strong>{entry.answers?.[key]}/10</strong>
                  </li>
                ))}
              </ul>
              {entry.extraThoughts && <p className='data-row-sub'>{entry.extraThoughts}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Pending queue (unchanged, see PendingFeedbackRequests.jsx) plus a history
// of feedback already given — this page absorbs what org/Journal.jsx used
// to cover conceptually ("look back at past activity"), though the
// underlying data is unrelated (feedback given to members, not the org's
// own host reflections — Journal itself still exists at /org/journal,
// just no longer linked from nav).
export function FeedbackRequests() {
  const { user } = useAuth();

  return (
    <PageMotion>
      {/* <TopBar title="Feedback Requests" /> */}
      <PendingFeedbackRequests
        scopeField='orgId'
        scopeValue={user.uid}
        title='Pending feedback requests'
      />
      <FeedbackHistory orgId={user.uid} />
    </PageMotion>
  );
}
