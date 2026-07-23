import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { callMarkFeedbackRead, callRequestQuestFeedback, callSubmitQuestReflection } from '@shared/fetch.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';
import { TopBar } from '@shared/TopBar.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { IconChevron } from '@shared/icons.jsx';

// Fixed defaults, same for every entry — not configurable per quest. See
// AI_README.md's "Quest Journal" section: answer one, all, or none of
// these, or just free-write. Purely a nudge to get started.
const REFLECTION_PROMPTS = [
  'What did you do during this quest and how did it go?',
  'Did anything surprise you or challenge you?',
  'How did this quest connect you to your community?',
  'What would you do differently next time?',
  'How did this quest reflect your leadership growth?',
];

// Mirrors FEEDBACK_QUESTIONS in functions/main.py by hand, same as every
// other constant kept in sync across the two sides of this app.
const FEEDBACK_QUESTIONS = {
  engagement: 'How actively did they participate and engage during the quest?',
  presence: 'How present and attentive were they throughout?',
  involvement: 'How involved were they in contributing to the group or task?',
  initiative: 'How much initiative did they show — stepping up or helping without being asked?',
  attitude: 'How positive and cooperative was their attitude?',
};

const FEEDBACK_REQUEST_MONTHLY_CAP = 3; // mirrors FEEDBACK_REQUEST_MONTHLY_CAP in functions/main.py

function toDate(value) {
  return value.toDate ? value.toDate() : new Date(value);
}

// The section covering a requested/answered piece of feedback for this
// entry — entirely separate from the always-present reflection below it.
// `requestsUsedThisMonth` is just a client-side hint for the "you've used
// N of 3" copy; the real cap enforcement is server-side in
// request_quest_feedback/submit_feedback_request_response.
function FeedbackSection({ entry, requestsUsedThisMonth, onRequested }) {
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');

  async function request() {
    setError('');
    setRequesting(true);
    try {
      await onRequested(entry.id);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setRequesting(false);
    }
  }

  if (!entry.requestStatus) {
    const atCap = requestsUsedThisMonth >= FEEDBACK_REQUEST_MONTHLY_CAP;
    return (
      <div className="journal-feedback">
        <p style={{ margin: 0 }} className="data-stat">
          Feeling good about how this one went? You can ask the organization for feedback on it — up to{' '}
          {FEEDBACK_REQUEST_MONTHLY_CAP} times a month.
        </p>
        {error && <p className="box-danger">{error}</p>}
        <StampButton type="button" onClick={request} disabled={requesting || atCap} style={{ marginTop: 8 }}>
          {requesting ? 'Requesting...' : atCap ? "You've used all your requests this month" : 'Request feedback'}
        </StampButton>
      </div>
    );
  }

  if (entry.requestStatus === 'pending') {
    const expired = entry.expiresAt && toDate(entry.expiresAt).getTime() < Date.now();
    return (
      <div className="journal-feedback">
        <p style={{ margin: 0 }} className="data-stat">
          {expired
            ? "Expired — the organization didn't respond in time."
            : 'Feedback requested — waiting on the organization to respond.'}
        </p>
      </div>
    );
  }

  return (
    <div className="journal-feedback">
      <span className="journal-rating">{entry.score}/10</span>
      <ul style={{ marginTop: 8 }}>
        {Object.entries(FEEDBACK_QUESTIONS).map(([key, question]) => (
          <li key={key}>
            {question} — <strong>{entry.answers?.[key]}/10</strong>
          </li>
        ))}
      </ul>
      {entry.extraThoughts && <p style={{ margin: 0 }}>{entry.extraThoughts}</p>}
      {entry.orgName && <p className="quest-org-line" style={{ marginTop: 6 }}>— {entry.orgName}</p>}
      {entry.pointsAwarded > 0 && (
        <p className="box-success" style={{ marginTop: 8 }}>
          You earned {entry.pointsAwarded} points for this!
        </p>
      )}
    </div>
  );
}

// One "tab" — an iPhone Notes-style entry, collapsed to just the quest
// title until opened. Opening it is also what marks it read (clears the
// BottomNav badge for this entry) — the live popup that pointed here
// doesn't do that itself, see functions/main.py's feedback module note.
function JournalEntry({ entry, requestsUsedThisMonth, onRequestFeedback }) {
  const [open, setOpen] = useState(false);
  // savedBody is the source of truth for what's actually persisted;
  // `editing` starts false whenever there's already something saved, so a
  // finished reflection reads as done — a plain block of text, not an
  // active input still inviting more typing — until the user explicitly
  // asks to change it.
  const [savedBody, setSavedBody] = useState(entry.reflectionBody || '');
  const [editing, setEditing] = useState(!(entry.reflectionBody || '').trim());
  const [body, setBody] = useState(entry.reflectionBody || '');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState('');
  const reduce = useReducedMotion();

  // A brief confirmation flash rather than a permanent "Saved" — clears
  // itself so it reads as an acknowledgment of *this* save, not a stale
  // leftover from one made a while ago.
  useEffect(() => {
    if (!justSaved) return undefined;
    const timer = setTimeout(() => setJustSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [justSaved]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    // Only entries with an actually-completed request ever have anything
    // to mark read — an entry with no feedback yet has never had `read`
    // set at all, so there's nothing for the BottomNav badge to be
    // counting here in the first place.
    if (next && entry.requestStatus === 'completed' && !entry.read) {
      try {
        await callMarkFeedbackRead(entry.id);
      } catch {
        // Non-critical — worst case the badge stays lit one extra visit.
      }
    }
  }

  function startEditing() {
    setBody(savedBody);
    setError('');
    setEditing(true);
  }

  function cancelEditing() {
    setBody(savedBody);
    setError('');
    setEditing(false);
  }

  async function saveReflection() {
    setError('');
    setSaving(true);
    try {
      await callSubmitQuestReflection({ questId: entry.id, body });
      setSavedBody(body);
      setJustSaved(true);
      // An empty save (clearing a reflection) has nothing to show as
      // "complete" — stay in the editing view for that case.
      if (body.trim()) setEditing(false);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ink-card journal-entry">
      <button type="button" className="journal-entry-head" onClick={toggle} aria-expanded={open}>
        <span className="journal-entry-title">
          {entry.questTitle}
          {!entry.read && entry.requestStatus === 'completed' && <span className="journal-entry-new">New</span>}
        </span>
        <IconChevron className="quest-chevron" data-open={open ? 'true' : 'false'} />
      </button>

      {open && (
        <div className="journal-entry-body">
          <FeedbackSection
            entry={entry}
            requestsUsedThisMonth={requestsUsedThisMonth}
            onRequested={onRequestFeedback}
          />

          <div className="journal-reflection">
            <h3>Your Reflection</h3>
            {editing ? (
              <>
                <p style={{ marginTop: 0 }}>Here are some questions you can think about to start your reflection:</p>
                <ul>
                  {REFLECTION_PROMPTS.map((prompt) => (
                    <li key={prompt}>{prompt}</li>
                  ))}
                </ul>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Answer one of these, all of them, or just free-write — whatever works for you."
                  style={{ minHeight: 140 }}
                />
                {error && <p className="box-danger">{error}</p>}
                <div className="flex items-center gap-sm" style={{ marginTop: 10 }}>
                  <StampButton type="button" variant="primary" onClick={saveReflection} disabled={saving}>
                    {saving ? 'Saving...' : 'Save reflection'}
                  </StampButton>
                  {savedBody.trim() && (
                    <StampButton type="button" onClick={cancelEditing} disabled={saving}>
                      Cancel
                    </StampButton>
                  )}
                </div>
              </>
            ) : (
              <div className="journal-reflection-complete">
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{savedBody}</p>
                <div className="flex items-center gap-sm" style={{ marginTop: 12 }}>
                  <StampButton type="button" onClick={startEditing} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
                    Edit reflection
                  </StampButton>
                  <AnimatePresence>
                    {justSaved && (
                      <motion.span
                        key="saved-confirmation"
                        initial={reduce ? false : { opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={reduce ? undefined : { opacity: 0 }}
                        className="journal-saved-confirmation"
                      >
                        ✓ Saved
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Every organization quest a user has checked into, one entry per
// occurrence — created the moment check-in happens (see check_in_to_event),
// independent of whether feedback is ever requested for it. Live
// (onSnapshot), same as the BottomNav badge and FeedbackToast, so a
// freshly-answered feedback request appears here without a reload.
export function Journal() {
  const { user, loading } = useAuth();
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    const q = query(collection(db, 'users', user.uid, 'journal'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [user]);

  // Cosmetic only (see FeedbackSection) — how many requests have already
  // completed this calendar month, across every entry.
  const requestsUsedThisMonth = useMemo(() => {
    if (!entries) return 0;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return entries.filter(
      (e) => e.requestStatus === 'completed' && e.completedAt && toDate(e.completedAt) >= monthStart,
    ).length;
  }, [entries]);

  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <PageMotion>
      <TopBar title="Journal" />
      {entries === null ? (
        <LoadingSpinner label="Loading your journal..." />
      ) : entries.length === 0 ? (
        <div className="quest-empty">
          <h2>No Entries Yet</h2>
          <p>Check into an organization quest to start your first journal entry.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-md">
          {entries.map((entry) => (
            <JournalEntry
              key={entry.id}
              entry={entry}
              requestsUsedThisMonth={requestsUsedThisMonth}
              onRequestFeedback={callRequestQuestFeedback}
            />
          ))}
        </div>
      )}
    </PageMotion>
  );
}
