import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { callSubmitHostReflection } from '@shared/fetch.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';
import { TopBar } from '@shared/TopBar.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { IconChevron } from '@shared/icons.jsx';

const DEFAULT_EVENT_WINDOW_HOURS = 6; // mirrors functions/main.py's DEFAULT_EVENT_WINDOW_HOURS

function toDate(value) {
  return value.toDate ? value.toDate() : new Date(value);
}

// A quest has "happened" once its own effective end has passed — the same
// check submit_host_reflection enforces server-side and the inverse of
// mobile/Quests.jsx's isUpcoming.
function hasHappened(quest) {
  if (!quest.eventDate) return false;
  const end = quest.eventEndTime
    ? toDate(quest.eventEndTime)
    : new Date(toDate(quest.eventDate).getTime() + DEFAULT_EVENT_WINDOW_HOURS * 60 * 60 * 1000);
  return end.getTime() < Date.now();
}

function formatEventDate(isoOrTimestamp) {
  if (!isoOrTimestamp) return null;
  const date = isoOrTimestamp.toDate ? isoOrTimestamp.toDate() : new Date(isoOrTimestamp);
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Fixed defaults, same for every entry — not configurable per quest. Purely
// a nudge to get started, same spirit as mobile/Journal.jsx's own prompts
// but aimed at the org's side of running the thing rather than attending it.
const HOST_REFLECTION_PROMPTS = [
  'What went well while hosting this quest?',
  'What was challenging about organizing or running it?',
  'How did attendees seem to respond?',
  'What would you do differently next time?',
];

// One "tab" per hosted occurrence, collapsed to just the quest title until
// opened. Mirrors mobile/Journal.jsx's JournalEntry, minus the incoming
// feedback block — there's no external message to display here, just the
// org's own reflection.
function HostJournalEntry({ entry }) {
  const [open, setOpen] = useState(false);
  const [savedBody, setSavedBody] = useState(entry.reflectionBody || '');
  const [editing, setEditing] = useState(!(entry.reflectionBody || '').trim());
  const [body, setBody] = useState(entry.reflectionBody || '');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState('');
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!justSaved) return undefined;
    const timer = setTimeout(() => setJustSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [justSaved]);

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
      await callSubmitHostReflection({ questId: entry.id, body });
      setSavedBody(body);
      setJustSaved(true);
      if (body.trim()) setEditing(false);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ink-card journal-entry">
      <button type="button" className="journal-entry-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="journal-entry-title">{entry.title}</span>
        <IconChevron className="quest-chevron" data-open={open ? 'true' : 'false'} />
      </button>

      {open && (
        <div className="journal-entry-body">
          {formatEventDate(entry.eventDate) && (
            <p className="quest-org-line" style={{ marginTop: 0 }}>{formatEventDate(entry.eventDate)}</p>
          )}

          <div className="journal-reflection">
            <h3>Your Reflection</h3>
            {editing ? (
              <>
                <p style={{ marginTop: 0 }}>Here are some questions you can think about to start your reflection:</p>
                <ul>
                  {HOST_REFLECTION_PROMPTS.map((prompt) => (
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

// Every quest occurrence this organization has hosted (its own effective
// end already passed), newest first, each merged with whatever reflection
// (if any) is already saved for it. The quest list itself is a one-time
// fetch (occurrences don't un-happen), but the reflections are live
// (onSnapshot) so a save made in one tab/device shows up without a reload.
export function Journal() {
  const { user, loading } = useAuth();
  const [quests, setQuests] = useState(null);
  const [reflections, setReflections] = useState({});

  useEffect(() => {
    if (!user) return undefined;
    getDocs(query(collection(db, 'quests'), where('orgId', '==', user.uid))).then((snap) => {
      setQuests(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(hasHappened));
    });
    return undefined;
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    const q = collection(db, 'organizations', user.uid, 'hostReflections');
    return onSnapshot(q, (snap) => {
      const byId = {};
      snap.docs.forEach((d) => {
        byId[d.id] = d.data();
      });
      setReflections(byId);
    });
  }, [user]);

  const entries = useMemo(() => {
    if (!quests) return null;
    return quests
      .map((quest) => ({
        id: quest.id,
        title: quest.title,
        eventDate: quest.eventDate,
        reflectionBody: reflections[quest.id]?.reflectionBody || '',
      }))
      .sort((a, b) => toDate(b.eventDate).getTime() - toDate(a.eventDate).getTime());
  }, [quests, reflections]);

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
          <p>Once you've hosted a quest, come back here to reflect on how it went.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-md">
          {entries.map((entry) => (
            <HostJournalEntry key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </PageMotion>
  );
}
