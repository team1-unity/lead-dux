import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { db } from './firebaseapp.jsx';
import { useAuth } from './AuthContext.jsx';
import { callMarkFeedbackNotified } from './fetch.jsx';
import { StampButton } from './StampButton.jsx';

// Fires the moment an organization sends feedback while the signed-in
// leader has the app open — a live Firestore listener on their own
// feedback subcollection (self-readable, see firestore.rules), not a
// check-on-load poll. Acting on it (either button) marks that one entry
// `notified` so it never pops up again; the journal's own unread badge is
// a separate flag (`read`) that only clears when the entry is actually
// opened, so dismissing this popup doesn't silently mark it as read.
export function FeedbackToast() {
  const { user, role } = useAuth();
  const [pending, setPending] = useState([]);
  const reduce = useReducedMotion();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user || (role !== 'user' && role !== 'pending_org')) return undefined;
    const q = query(collection(db, 'users', user.uid, 'feedback'), where('notified', '==', false));
    return onSnapshot(q, (snap) => {
      setPending(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [user, role]);

  const current = pending[0];
  if (!current) return null;

  async function dismiss() {
    await callMarkFeedbackNotified(current.id);
  }

  async function viewInJournal() {
    await callMarkFeedbackNotified(current.id);
    navigate('/journal');
  }

  return (
    <AnimatePresence>
      <motion.div
        className="feedback-toast-backdrop"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="ink-card feedback-toast"
          initial={reduce ? false : { opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          role="alertdialog"
          aria-label="New quest feedback"
        >
          <h2>Congratulations!</h2>
          <p>
            You completed <strong>{current.questTitle}</strong> and earned{' '}
            <strong>{current.pointsAwarded} points</strong>. View your feedback in your journal!
          </p>
          <div className="flex gap-sm">
            <StampButton type="button" variant="primary" onClick={viewInJournal} style={{ flex: 1 }}>
              View in Journal
            </StampButton>
            <StampButton type="button" onClick={dismiss}>
              Dismiss
            </StampButton>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
