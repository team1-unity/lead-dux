import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebaseapp.jsx';
import { callSubmitFeedbackRequestResponse } from './fetch.jsx';
import { LoadingSpinner } from './LoadingSpinner.jsx';
import { StampButton } from './StampButton.jsx';

// The 5-question form an org fills out to answer one leader's feedback
// request — keys/copy mirror FEEDBACK_QUESTIONS in functions/main.py by
// hand, same as every other ladder/constant kept in sync across the two
// sides of this app.
const FEEDBACK_QUESTIONS = {
  engagement: 'How actively did they participate and engage during the quest?',
  presence: 'How present and attentive were they throughout?',
  involvement: 'How involved were they in contributing to the group or task?',
  initiative: 'How much initiative did they show — stepping up or helping without being asked?',
  attitude: 'How positive and cooperative was their attitude?',
};
const RATING_OPTIONS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const DEFAULT_ANSWERS = Object.fromEntries(Object.keys(FEEDBACK_QUESTIONS).map((key) => [key, 8]));

function toDate(value) {
  return value.toDate ? value.toDate() : new Date(value);
}

// Reviewer queue for pending feedback requests (see request_quest_feedback/
// submit_feedback_request_response in functions/main.py). Same shape as
// PendingPhotoSubmissions.jsx — scopeField/scopeValue lets the org
// dashboard scope to its own quests (orgId) — feedback requests only ever
// exist for organization quests, so there's no admin/isDefault variant.
// Anything already past its expiresAt is filtered out client-side rather
// than shown as actionable — submitting a response for one would just
// fail server-side, so there's nothing useful to do with it here.
export function PendingFeedbackRequests({ scopeField, scopeValue, title = 'Pending feedback requests' }) {
  const [requests, setRequests] = useState(null);
  const [answersById, setAnswersById] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const snap = await getDocs(
      query(collection(db, 'feedbackRequests'), where('status', '==', 'pending'), where(scopeField, '==', scopeValue)),
    );
    const now = Date.now();
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => toDate(r.expiresAt).getTime() > now);
    setRequests(rows);
    setAnswersById((prev) =>
      Object.fromEntries(rows.map((r) => [r.id, prev[r.id] || { ...DEFAULT_ANSWERS, extraThoughts: '' }])),
    );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeField, scopeValue]);

  function updateAnswer(requestId, key, value) {
    setAnswersById((prev) => ({ ...prev, [requestId]: { ...prev[requestId], [key]: value } }));
  }

  async function submit(r) {
    setError('');
    setBusyId(r.id);
    try {
      const { extraThoughts, ...answers } = answersById[r.id];
      await callSubmitFeedbackRequestResponse({
        questId: r.questId,
        uid: r.uid,
        answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, Number(v)])),
        extraThoughts: extraThoughts.trim() || undefined,
      });
      await load();
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  }

  if (!requests) return <LoadingSpinner label="Loading feedback requests..." />;

  return (
    <section style={{ marginBottom: 24 }}>
      <h2>{title}</h2>
      {error && <p className="box-danger">{error}</p>}
      {requests.length === 0 ? (
        <p>No pending feedback requests.</p>
      ) : (
        <div className="ink-card data-list">
          {requests.map((r) => (
            <div key={r.id} className="data-row">
              <div className="data-row-head">
                <p className="data-row-title">{r.questTitle}</p>
                <span className="data-stat">Requested by a leader who attended</span>
              </div>
              <div className="flex flex-col gap-md" style={{ marginTop: 8 }}>
                {Object.entries(FEEDBACK_QUESTIONS).map(([key, question]) => (
                  <label key={key} className="flex justify-between items-center gap-sm" style={{ flexWrap: 'wrap' }}>
                    {question}
                    <select
                      value={answersById[r.id]?.[key] ?? 8}
                      onChange={(e) => updateAnswer(r.id, key, e.target.value)}
                    >
                      {RATING_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label>
                  Extra thoughts (optional)
                  <textarea
                    value={answersById[r.id]?.extraThoughts ?? ''}
                    onChange={(e) => updateAnswer(r.id, 'extraThoughts', e.target.value)}
                  />
                </label>
              </div>
              <div className="data-row-actions" style={{ marginTop: 10 }}>
                <StampButton type="button" variant="primary" onClick={() => submit(r)} disabled={busyId === r.id}>
                  {busyId === r.id ? 'Submitting...' : 'Submit feedback'}
                </StampButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
