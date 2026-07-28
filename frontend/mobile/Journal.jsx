import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import {
  callMarkFeedbackRead,
  callRequestQuestFeedback,
  callSetJournalThumbnail,
  callSubmitQuestReflection,
} from '@shared/fetch.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';
import { TopBar } from '@shared/TopBar.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { LightboxBackdrop } from '@shared/LightboxBackdrop.jsx';
import { IconDots, IconX } from '@shared/icons.jsx';

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

// A small curated set of background pictures a member can pick for a saved
// entry (see set_journal_thumbnail in functions/main.py) — no upload flow,
// just a handful of stock photos plus "remove". The first one doubles as
// the default look for a saved entry that never had one picked.
const THUMBNAIL_OPTIONS = [
  'https://images.unsplash.com/photo-1554080353-a576cf803bda?auto=format&fit=crop&w=400&q=60',
  'https://images.unsplash.com/photo-1505144808419-1957a94ca61e?auto=format&fit=crop&w=400&q=60',
  'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=400&q=60',
];
const DEFAULT_THUMBNAIL = THUMBNAIL_OPTIONS[0];

function toDate(value) {
  return value.toDate ? value.toDate() : new Date(value);
}

// The section covering a requested/answered piece of feedback for this
// entry — entirely separate from the always-present reflection below it.
// `requestsUsedThisMonth` is just a client-side hint for the "you've used
// N of 3" copy; the real cap enforcement is server-side in
// request_quest_feedback/submit_feedback_request_response.
//
// `autoRequest`: the card's 3-dot menu's "Request feedback" item opens
// straight into the expanded entry and fires this section's own request()
// once on mount, rather than duplicating its loading/error handling at the
// call site — see ExpandedJournalEntry below.
function FeedbackSection({ entry, requestsUsedThisMonth, onRequested, autoRequest }) {
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

  useEffect(() => {
    if (autoRequest && !entry.requestStatus) request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRequest]);

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

// True count of columns to lay entries out into — 1 narrow / 2 mid / 3
// wide. Kept as a fixed number (not a CSS auto-fit grid) since the
// parallax offset below is computed per column and needs to know up front
// how many there are.
function useColumnCount() {
  function computeCount() {
    if (window.matchMedia('(min-width: 900px)').matches) return 3;
    if (window.matchMedia('(min-width: 600px)').matches) return 2;
    return 1;
  }
  const [count, setCount] = useState(computeCount);
  useEffect(() => {
    const queries = ['(min-width: 900px)', '(min-width: 600px)'].map((q) => window.matchMedia(q));
    const handler = () => setCount(computeCount());
    queries.forEach((mql) => mql.addEventListener('change', handler));
    return () => queries.forEach((mql) => mql.removeEventListener('change', handler));
  }, []);
  return count;
}

// --- Adapted from the "ParallaxScroll" reference pattern ---
//
// The reference splits images round-robin into 3 fixed columns, each with
// its own useTransform mapping one shared useScroll's progress to a
// different vertical offset (alternating direction per column) so the
// columns drift past each other as you scroll — and it gets a scroll range
// to work with no matter how much content there is by tracking a
// *fixed-height, internally-scrollable* container (useScroll({ container })
// against a box with its own overflow-y: auto), not the page's own scroll.
//
// An earlier version of this tied the offset to the *page's* scroll
// instead (useScroll({ target })), reasoning that this app never nests a
// second scrollbar inside a page — but that means the "container entering/
// exiting the viewport" progress it needs never actually spans a real
// range whenever the whole grid fits on screen at once (a Journal with
// only a handful of entries, on any reasonably tall monitor), so the
// transform barely moves and the effect reads as entirely absent. Matching
// the reference's real mechanism (see .journal-columns' max-height +
// overflow-y in style.css) fixes that — it always has a genuine 0-to-1
// scroll range to animate against as long as there's more content than
// fits in the box, independent of total entry count.
//
// Column count is 1/2/3 here (see useColumnCount) rather than always 3,
// and the offset is a smaller range than the reference's full-bleed photo
// wall — these cards hold real buttons and menus, so it's a clear but not
// disorienting depth cue. Disabled entirely (flat, static grid) for
// reduced-motion users or a single column, where there's nothing to offset
// against.
function useParallaxColumnOffsets(containerRef, columnCount, disabled) {
  const { scrollYProgress } = useScroll({ container: containerRef, offset: ['start start', 'end start'] });
  // Always call a fixed number of hooks regardless of columnCount (rules
  // of hooks) — only as many as columnCount are actually used below.
  const t0 = useTransform(scrollYProgress, [0, 1], disabled ? [0, 0] : [0, -80]);
  const t1 = useTransform(scrollYProgress, [0, 1], disabled ? [0, 0] : [0, 80]);
  const t2 = useTransform(scrollYProgress, [0, 1], disabled ? [0, 0] : [0, -80]);
  return [t0, t1, t2].slice(0, columnCount);
}

// --- Adapted from the "LayoutGrid" reference pattern ---
//
// One 3-dot menu, shared by both card states (see JournalCard below) — own
// click-outside/Escape/focus-return handling, deliberately not built by
// generalizing AddPropertyMenu.jsx (that component has one existing caller
// with different semantics — a filtered add-list, not a fixed 3 actions —
// so forcing a shared base now is more risk than this ~30 lines of overlap
// is worth).
function JournalCardMenu({ entry, onChangePicture, onRequestFeedback, onEdit }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (!triggerRef.current?.parentElement?.contains(e.target)) close();
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function select(action) {
    setOpen(false);
    action();
  }

  const hasReflection = Boolean((entry.reflectionBody || '').trim());

  return (
    <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        className="journal-card-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Options for ${entry.questTitle}`}
        onClick={() => setOpen((v) => !v)}
      >
        <IconDots width={16} height={16} />
      </button>
      {open && (
        <div className="ink-card journal-card-menu" role="menu" aria-label="Journal entry options">
          <button
            type="button"
            role="menuitem"
            className="journal-card-menu-item"
            onClick={() => select(onChangePicture)}
          >
            Change background picture
          </button>
          <button
            type="button"
            role="menuitem"
            className="journal-card-menu-item"
            onClick={() => select(onRequestFeedback)}
          >
            Request feedback
          </button>
          <button type="button" role="menuitem" className="journal-card-menu-item" onClick={() => select(onEdit)}>
            {hasReflection ? 'Edit journal entry' : 'Write journal entry'}
          </button>
        </div>
      )}
    </div>
  );
}

// A collapsed grid cell — carries the layoutId the expanded view (below)
// shares, so clicking it morphs into that centered card instead of just
// appearing. Two visual states, driven off whether a reflection has
// actually been saved yet (there's no third "locked/upcoming" state: every
// journal entry here already represents a quest the caller has checked
// into — see check_in_to_event in main.py — so nothing is ever "not yet
// available").
function JournalCard({ entry, isOpen, onOpen, onChangePicture, onRequestFeedback, onEdit }) {
  const state = (entry.reflectionBody || '').trim() ? 'saved' : 'unwritten';
  const isNew = !entry.read && entry.requestStatus === 'completed';

  function onKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  }

  return (
    <motion.div
      layoutId={`journal-card-${entry.id}`}
      className="journal-card"
      data-state={state}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      aria-label={entry.questTitle}
      // Hidden while its expanded twin (sharing the same layoutId) is
      // showing — otherwise the grid position would just sit there
      // unchanged underneath the animating morph instead of reading as
      // "this card became that one".
      animate={{ opacity: isOpen ? 0 : 1 }}
      transition={{ duration: 0.15 }}
    >
      {state === 'saved' && (
        <>
          <img src={entry.thumbnailUrl || DEFAULT_THUMBNAIL} alt="" className="journal-card-bg" loading="lazy" />
          <div className="journal-card-scrim" aria-hidden="true" />
        </>
      )}
      <JournalCardMenu
        entry={entry}
        onChangePicture={onChangePicture}
        onRequestFeedback={onRequestFeedback}
        onEdit={onEdit}
      />
      {isNew && <span className="journal-card-new-badge">New</span>}
      <p className="journal-card-title">{entry.questTitle}</p>
      {state === 'unwritten' && <p className="journal-card-hint">✎ Tap to reflect</p>}
    </motion.div>
  );
}

// The morphed, centered version of a JournalCard — rendered inside
// LightboxBackdrop (portal to document.body, scroll-lock, click-outside
// and Escape all already handled there; see its own module note for why
// this app specifically needs the portal — PageMotion's resting transform
// would otherwise break true-viewport centering for a nested
// position:fixed element the same way it did before that component
// existed). The outer layoutId is what morphs from the grid position; the
// inner one fades its content up from below once settled — same two-layer
// shape the LayoutGrid reference's SelectedCard uses.
function ExpandedJournalEntry({ entry, requestsUsedThisMonth, onClose, startInEditMode, autoRequestFeedback }) {
  const [savedBody, setSavedBody] = useState(entry.reflectionBody || '');
  const [editing, setEditing] = useState(startInEditMode || !(entry.reflectionBody || '').trim());
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

  // Opening this entry is also what marks it read (clears the BottomNav
  // badge) — mirrors the old accordion's toggle() side effect, just moved
  // to fire once on mount instead of on every open/close.
  useEffect(() => {
    if (entry.requestStatus === 'completed' && !entry.read) {
      callMarkFeedbackRead(entry.id).catch(() => {
        // Non-critical — worst case the badge stays lit one extra visit.
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <LightboxBackdrop onClose={onClose} label={`${entry.questTitle} journal entry`}>
      <motion.div
        layoutId={`journal-card-${entry.id}`}
        className="journal-expanded-card"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="journal-expanded-close" onClick={onClose} aria-label="Close">
          <IconX width={18} height={18} />
        </button>
        <motion.div
          layoutId={`journal-content-${entry.id}`}
          initial={reduce ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.25, ease: 'easeInOut' }}
        >
          <h2 style={{ marginTop: 0, paddingRight: 28 }}>{entry.questTitle}</h2>

          <FeedbackSection
            entry={entry}
            requestsUsedThisMonth={requestsUsedThisMonth}
            onRequested={callRequestQuestFeedback}
            autoRequest={autoRequestFeedback}
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
        </motion.div>
      </motion.div>
    </LightboxBackdrop>
  );
}

// The "Change background picture" menu item's destination — a simple
// modal-on-top (no shared-element concerns, unlike the expand/morph
// interaction above), so LightboxBackdrop is a direct fit as-is.
function ThumbnailPicker({ entry, onClose }) {
  const [saving, setSaving] = useState(null); // the url (or null-for-"remove") currently being saved, or undefined
  const [error, setError] = useState('');

  async function pick(url) {
    setSaving(url ?? 'remove');
    setError('');
    try {
      await callSetJournalThumbnail({ questId: entry.id, thumbnailUrl: url });
      onClose();
    } catch (err) {
      setError(getAuthErrorMessage(err));
      setSaving(null);
    }
  }

  return (
    <LightboxBackdrop onClose={onClose} label="Choose a background picture">
      <div className="journal-expanded-card" style={{ width: 'min(420px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="journal-expanded-close" onClick={onClose} aria-label="Close">
          <IconX width={18} height={18} />
        </button>
        <h3 style={{ marginTop: 0, paddingRight: 28 }}>Choose a background picture</h3>
        {error && <p className="box-danger">{error}</p>}
        <div className="journal-thumbnail-picker-grid">
          <button
            type="button"
            className="journal-thumbnail-picker-option flex items-center justify-center"
            data-selected={!entry.thumbnailUrl ? 'true' : 'false'}
            onClick={() => pick(null)}
            disabled={Boolean(saving)}
            aria-label="Remove picture"
          >
            <span className="field-optional" style={{ fontSize: '0.75rem' }}>
              {saving === 'remove' ? '...' : 'None'}
            </span>
          </button>
          {THUMBNAIL_OPTIONS.map((url) => (
            <button
              key={url}
              type="button"
              className="journal-thumbnail-picker-option"
              data-selected={entry.thumbnailUrl === url ? 'true' : 'false'}
              onClick={() => pick(url)}
              disabled={Boolean(saving)}
              aria-label="Use this picture"
            >
              <img src={url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      </div>
    </LightboxBackdrop>
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
  // Which entry (if any) is expanded, and how it was opened — card-body
  // clicks open in read mode with no auto-action; the 3-dot menu's "Edit"
  // forces edit mode, and its "Request feedback" fires that request
  // immediately (see FeedbackSection's autoRequest above).
  const [openAction, setOpenAction] = useState(null); // { id, edit, autoRequest } | null
  const [pickingId, setPickingId] = useState(null);
  const reduce = useReducedMotion();
  const gridRef = useRef(null);
  const columnCount = useColumnCount();
  const columnOffsets = useParallaxColumnOffsets(gridRef, columnCount, reduce || columnCount === 1);

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

  // Round-robin distribution into N columns — see useParallaxColumnOffsets'
  // own module note on why this can't just be a CSS auto-fit grid.
  const columns = useMemo(() => {
    const cols = Array.from({ length: columnCount }, () => []);
    (entries || []).forEach((entry, i) => cols[i % columnCount].push(entry));
    return cols;
  }, [entries, columnCount]);

  const openEntry = useMemo(
    () => (openAction ? entries?.find((e) => e.id === openAction.id) : null),
    [entries, openAction],
  );
  const pickingEntry = useMemo(() => entries?.find((e) => e.id === pickingId), [entries, pickingId]);

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
        <div className="journal-columns" ref={gridRef}>
          {columns.map((column, i) => (
            <motion.div key={i} className="journal-column" style={{ y: columnOffsets[i] }}>
              {column.map((entry) => (
                <JournalCard
                  key={entry.id}
                  entry={entry}
                  isOpen={openAction?.id === entry.id}
                  onOpen={() => setOpenAction({ id: entry.id, edit: false, autoRequest: false })}
                  onChangePicture={() => setPickingId(entry.id)}
                  onRequestFeedback={() => setOpenAction({ id: entry.id, edit: false, autoRequest: true })}
                  onEdit={() => setOpenAction({ id: entry.id, edit: true, autoRequest: false })}
                />
              ))}
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {openEntry && (
          <ExpandedJournalEntry
            key={openEntry.id}
            entry={openEntry}
            requestsUsedThisMonth={requestsUsedThisMonth}
            onClose={() => setOpenAction(null)}
            startInEditMode={openAction?.edit}
            autoRequestFeedback={openAction?.autoRequest}
          />
        )}
      </AnimatePresence>

      {pickingEntry && <ThumbnailPicker entry={pickingEntry} onClose={() => setPickingId(null)} />}
    </PageMotion>
  );
}
