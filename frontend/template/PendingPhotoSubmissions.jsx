import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { db, storage } from './firebaseapp.jsx';
import { callApprovePhotoSubmission, callRejectPhotoSubmission } from './fetch.jsx';
import { LoadingSpinner } from './LoadingSpinner.jsx';
import { StampButton } from './StampButton.jsx';

// Reviewer queue for pending quest photo submissions (see
// submit_quest_photo/approve_photo_submission/reject_photo_submission in
// functions/main.py). Used by both the org dashboard (own quests —
// scopeField="orgId", scopeValue={user.uid}) and the admin dashboard (side
// quests — scopeField="isDefault", scopeValue={true}); approve/reject are
// gated server-side by ownership, this component just scopes which
// pending submissions are queried for.
export function PendingPhotoSubmissions({ scopeField, scopeValue, title = 'Pending photo submissions' }) {
  const [submissions, setSubmissions] = useState(null);
  const [urls, setUrls] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState('');

  async function load() {
    const snap = await getDocs(
      query(collection(db, 'photoSubmissions'), where('status', '==', 'pending'), where(scopeField, '==', scopeValue)),
    );
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setSubmissions(rows);
    const entries = await Promise.all(
      rows.map(async (r) => [r.id, await getDownloadURL(storageRef(storage, r.storagePath)).catch(() => null)]),
    );
    setUrls(Object.fromEntries(entries));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeField, scopeValue]);

  async function approve(s) {
    setBusyId(s.id);
    try {
      await callApprovePhotoSubmission({ questId: s.questId, userId: s.userId });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function reject(s) {
    setBusyId(s.id);
    try {
      await callRejectPhotoSubmission({ questId: s.questId, userId: s.userId, reason });
      setRejectingId(null);
      setReason('');
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (!submissions) return <LoadingSpinner label="Loading photo submissions..." />;

  return (
    <section style={{ marginBottom: 24 }}>
      <h2>{title}</h2>
      {submissions.length === 0 ? (
        <p>No pending photo submissions.</p>
      ) : (
        <div className="ink-card data-list">
          {submissions.map((s) => (
            <div key={s.id} className="data-row">
              <div className="data-row-head">
                <p className="data-row-title">{s.userName || 'Unnamed'}</p>
                <span className="data-stat">{s.questTitle}</span>
              </div>
              {urls[s.id] && (
                <img
                  src={urls[s.id]}
                  alt="Submitted proof"
                  style={{ maxWidth: 240, borderRadius: 'var(--radius)', marginTop: 8 }}
                />
              )}
              <div className="data-row-actions" style={{ marginTop: 8 }}>
                <StampButton type="button" variant="primary" onClick={() => approve(s)} disabled={busyId === s.id}>
                  {busyId === s.id ? 'Approving...' : 'Approve'}
                </StampButton>
                <StampButton
                  type="button"
                  variant="danger"
                  onClick={() => setRejectingId(rejectingId === s.id ? null : s.id)}
                  disabled={busyId === s.id}
                >
                  Reject
                </StampButton>
              </div>
              {rejectingId === s.id && (
                <div className="flex flex-col gap-sm" style={{ marginTop: 8 }}>
                  <textarea
                    placeholder="Reason (optional)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <StampButton type="button" variant="danger" onClick={() => reject(s)} disabled={busyId === s.id}>
                    {busyId === s.id ? 'Rejecting...' : 'Confirm reject'}
                  </StampButton>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
