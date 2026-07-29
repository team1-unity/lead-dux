import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { db } from '@shared/firebaseapp.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { IconChevron } from '@shared/icons.jsx';
import { FeedbackRequestPanel } from './FeedbackRequestPanel.jsx';

function toDate(value) {
  return value.toDate ? value.toDate() : new Date(value);
}

// Reviewer queue for pending feedback requests (see request_quest_feedback/
// submit_feedback_request_response in functions/main.py). Feedback requests
// only ever exist for organization quests (no admin/isDefault variant), so
// this replaces the old generic scopeField/scopeValue
// PendingFeedbackRequests.jsx, which only ever had this one caller —
// scoping straight to orgId instead. Anything already past its expiresAt
// is filtered out client-side rather than shown as actionable — submitting
// a response for one would just fail server-side.
//
// The row's attendee name comes straight off r.requesterName, denormalized
// onto the request doc by request_quest_feedback itself (Admin SDK, so it
// can read users/{uid} directly) — an org account can't read another
// user's users/{uid} doc client-side (firestore.rules only allows a user
// to read their own), so there's no live lookup to do here.
export function PendingFeedbackList({ orgId, title = 'Pending feedback requests' }) {
  const [requests, setRequests] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const reduce = useReducedMotion();

  async function load() {
    const snap = await getDocs(
      query(collection(db, 'feedbackRequests'), where('status', '==', 'pending'), where('orgId', '==', orgId)),
    );
    const now = Date.now();
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => toDate(r.expiresAt).getTime() > now);
    setRequests(rows);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // Single-expand: opening a row closes whichever other one was open. The
  // spec left this an open choice ("your call") — one row is simpler to
  // reason about for a step-through flow the org is meant to focus on, and
  // matches the one-active-thing-at-a-time feel of the rating flow itself.
  function toggle(id) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  async function handleSubmitted() {
    setExpandedId(null);
    await load();
  }

  if (!requests) return <LoadingSpinner label="Loading feedback requests..." />;

  return (
    <section style={{ marginBottom: 24 }}>
      <h2>{title}</h2>
      {requests.length === 0 ? (
        <p>No pending feedback requests.</p>
      ) : (
        <div className="ink-card data-list">
          {requests.map((r) => {
            const isOpen = expandedId === r.id;
            return (
              <div key={r.id} className="feedback-row">
                <button
                  type="button"
                  className="feedback-row-head"
                  onClick={() => toggle(r.id)}
                  aria-expanded={isOpen}
                >
                  <span className="feedback-row-heading">
                    <span className="feedback-row-title">{r.questTitle}</span>
                    <span className="feedback-row-name">{r.requesterName || 'Unnamed'}</span>
                  </span>
                  <motion.span
                    className="feedback-row-chevron"
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={reduce ? { duration: 0 } : { duration: 0.2 }}
                  >
                    <IconChevron width={18} height={18} />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      className="feedback-row-panel-wrap"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={reduce ? { duration: 0 } : { duration: 0.25, ease: 'easeOut' }}
                    >
                      {/* Fresh component instance per open — component-local
                          rating/currentIndex state resets whenever a row is
                          collapsed and reopened, per the spec ("lift up
                          only if there's a reason to persist across
                          collapses"). */}
                      <FeedbackRequestPanel request={r} onSubmitted={handleSubmitted} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
