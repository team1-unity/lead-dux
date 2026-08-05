import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'framer-motion';
import { db, storage } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { callMarkFeedbackRead, callSetJournalThumbnail, callSubmitQuestReflection } from '@shared/fetch.jsx';
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

// A small curated set of background pictures a member can pick for an
// entry (see set_journal_thumbnail in functions/main.py) — no upload flow,
// just a handful of stock photos plus "remove". A card with none picked
// yet stays blank (see JournalCard) rather than falling back to one of
// these by default.
const THUMBNAIL_OPTIONS = [
  'https://images.unsplash.com/photo-1554080353-a576cf803bda?auto=format&fit=crop&w=400&q=60',
  'https://images.unsplash.com/photo-1505144808419-1957a94ca61e?auto=format&fit=crop&w=400&q=60',
  'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=400&q=60',
];

// A user-uploaded background picture instead — same validation/path shape
// Profile.jsx's own avatar upload already uses (see journalThumbnails/{uid}
// in storage.rules), just a different folder.
const THUMBNAIL_UPLOAD_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];
const THUMBNAIL_UPLOAD_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const THUMBNAIL_UPLOAD_EXT_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

function toDate(value) {
  return value.toDate ? value.toDate() : new Date(value);
}

// Read-only — whatever the organization has already said (or "waiting"/
// "expired") about a feedback request already made for this entry. Shown
// below the reflection (see ExpandedJournalEntry's render order) whenever
// entry.requestStatus is set. The *action* of making a new request now
// lives on the quest's own Past Attended detail (mobile/Quests.jsx)
// instead of here — testing found requesting feedback from inside the
// journal wasn't an intuitive place to look for it, even though the
// request's result still lands back in the journal entry it's about.
//
// The completed case never renders entry.score/entry.answers — those
// still exist on the doc (the org's own record, and what the point bonus
// is computed from server-side), but request_quest_feedback's own
// _generate_feedback_summary turns them into entry.summary/entry.
// growthArea before this ever sees them, so no numeric rating reaches the
// leader. The points-awarded line that used to live here is gone too —
// submit_feedback_request_response now fires a Home-screen notice for
// that instead (see NotificationBanner.jsx), so repeating it a second
// time, permanently, inside the entry itself was redundant.
function FeedbackStatus({ entry }) {
  if (!entry.requestStatus) return null;

  if (entry.requestStatus === 'pending') {
    const expired = entry.expiresAt && toDate(entry.expiresAt).getTime() < Date.now();
    return (
      <p className='journal-feedback-pending data-stat'>
        {expired
          ? "Expired — the organization didn't respond in time."
          : 'Feedback requested — waiting on the organization to respond.'}
      </p>
    );
  }

  return (
    <div className='journal-feedback'>
      <hr className='journal-feedback-divider' />
      <p className='quest-title' style={{ fontSize: '0.95rem', margin: '0 0 8px' }}>
        Your feedback
      </p>
      <p style={{ margin: 0 }}>{entry.summary}</p>
      {entry.growthArea && (
        <p style={{ margin: '8px 0 0' }}>
          <strong>Opportunity for Growth</strong> — {entry.growthArea}
        </p>
      )}
      {entry.extraThoughts && (
        <blockquote className='journal-feedback-quote'>{entry.extraThoughts}</blockquote>
      )}
      {entry.orgName && (
        <p className='quest-org-line' style={{ marginTop: 6 }}>
          — {entry.orgName}
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
// columns drift past each other as you scroll. The reference gets its
// scroll range from a dedicated fixed-height, internally-scrollable
// container — this app deliberately doesn't nest a second scrollbar
// inside a page, so this tracks the *page's own* scroll instead
// (useScroll() with no target/container at all tracks the document itself
// — 0 at the very top of the page, 1 at the very bottom), and
// .journal-columns is a plain, non-scrolling part of the page's normal
// flow rather than its own box.
//
// Column count is 1/2/3 here (see useColumnCount) rather than always 3,
// and the offset is a smaller range than the reference's full-bleed photo
// wall — these cards hold real buttons and menus, so it's a clear but not
// disorienting depth cue. Disabled entirely (flat, static grid) for
// reduced-motion users or a single column, where there's nothing to offset
// against.
function useParallaxColumnOffsets(columnCount, disabled) {
  const { scrollYProgress } = useScroll();
  // scrollYProgress jumps in whatever discrete increments the browser
  // reports for a given scroll input (a mouse wheel notch can easily be
  // 100+ px in one event) — feeding that straight into useTransform makes
  // the column jump to each new position instantly rather than gliding,
  // which reads as a "snap" rather than a smooth drift regardless of how
  // correct the underlying math is. useSpring adds inertia on top of the
  // raw value — the transform now eases toward wherever scroll currently
  // is instead of teleporting there.
  const smoothProgress = useSpring(scrollYProgress, { stiffness: 100, damping: 30, mass: 0.5 });
  // Always call a fixed number of hooks regardless of columnCount (rules
  // of hooks) — only as many as columnCount are actually used below.
  const t0 = useTransform(smoothProgress, [0, 1], disabled ? [0, 0] : [0, -80]);
  const t1 = useTransform(smoothProgress, [0, 1], disabled ? [0, 0] : [0, 80]);
  const t2 = useTransform(smoothProgress, [0, 1], disabled ? [0, 0] : [0, -80]);
  return { offsets: [t0, t1, t2].slice(0, columnCount), scrollYProgress: smoothProgress };
}

// --- Adapted from the "LayoutGrid" reference pattern ---
//
// The 3-dot menu — lives inside the *expanded* card only (not the
// collapsed grid cell; a collapsed card shows nothing but its background
// picture and title). Own click-outside/Escape/focus-return handling,
// deliberately not built by generalizing AddPropertyMenu.jsx (that
// component has one existing caller with different semantics — a filtered
// add-list, not a fixed set of actions — so forcing a shared base now is
// more risk than this ~30 lines of overlap is worth). "Request feedback"
// only shows up before a request has ever been made — once
// entry.requestStatus is set, there's nothing left to request until next
// month, and FeedbackStatus already shows the result inline.
function JournalCardMenu({ entry, isEditing, onChangePicture, onEdit }) {
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
    // Deliberately NOT position:relative — .journal-card-menu-trigger and
    // .journal-card-menu both position absolutely relative to
    // .journal-expanded-card (the nearest *positioned* ancestor once this
    // plain div is skipped), which is what actually anchors them to the
    // card's real corners. Giving this wrapper its own position:relative
    // was the bug: it's only as tall as the trigger button, sitting near
    // the top of the card in normal flow, so a `bottom`-anchored child
    // measured from *its* bottom edge — not the card's — landing near the
    // top instead. The div itself still groups trigger+menu for the
    // outside-click check below (triggerRef.current.parentElement).
    <div>
      <button
        ref={triggerRef}
        type='button'
        className='journal-card-menu-trigger'
        aria-haspopup='menu'
        aria-expanded={open}
        aria-label={`Options for ${entry.questTitle}`}
        onClick={() => setOpen((v) => !v)}
      >
        <IconDots width={16} height={16} />
      </button>
      {open && (
        <div className='ink-card journal-card-menu' role='menu' aria-label='Journal entry options'>
          <button
            type='button'
            role='menuitem'
            className='journal-card-menu-item'
            onClick={() => select(onChangePicture)}
          >
            Change background picture
          </button>
          {/* A new/unwritten entry already opens straight into the write
              form (see ExpandedJournalEntry's initial `editing` state) —
              nothing for this item to switch into, so it's only offered
              once there's an actual saved reflection to go back and edit —
              and not while already mid-edit, for the same reason. */}
          {hasReflection && !isEditing && (
            <button
              type='button'
              role='menuitem'
              className='journal-card-menu-item'
              onClick={() => select(onEdit)}
            >
              Edit journal entry
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// A collapsed grid cell — carries the layoutId the expanded view (below)
// shares, so clicking it morphs into that centered card instead of just
// appearing. Nothing but the background picture and the quest title (plus
// an unread-feedback indicator, which is real status, not decoration) —
// no menu here and no distinction for whether a reflection exists yet;
// that's all inside the expanded view now.
function JournalCard({ entry, isOpen, onOpen }) {
  const isNew = !entry.read && entry.requestStatus === 'completed';

  // thumbnailUrl is usually already a plain, directly-usable URL (the
  // curated stock picks, or an uploaded picture — both resolved before
  // set_journal_thumbnail ever stores them), but approve_photo_submission
  // can also auto-fill it with a raw Storage path (see that function's own
  // note in functions/main.py) when a leader's proof photo gets approved.
  // Same maybe-a-path-maybe-a-URL resolution HeroCarousel.jsx/
  // PendingPhotoReview.jsx already do for org photos.
  const [resolvedUrl, setResolvedUrl] = useState(null);
  useEffect(() => {
    if (!entry.thumbnailUrl) {
      setResolvedUrl(null);
      return undefined;
    }
    if (/^https?:\/\//.test(entry.thumbnailUrl)) {
      setResolvedUrl(entry.thumbnailUrl);
      return undefined;
    }
    let cancelled = false;
    getDownloadURL(storageRef(storage, entry.thumbnailUrl))
      .then((url) => {
        if (!cancelled) setResolvedUrl(url);
      })
      .catch(() => {
        if (!cancelled) setResolvedUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.thumbnailUrl]);

  function onKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  }

  const hasPicture = Boolean(resolvedUrl);

  return (
    <motion.div
      layoutId={`journal-card-${entry.id}`}
      className='journal-card'
      data-has-picture={hasPicture ? 'true' : 'false'}
      role='button'
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
      {/* Blank until a picture is actually chosen (see "Change background
          picture" in the expanded card's menu) or auto-filled from an
          approved proof photo (see approve_photo_submission) — no default
          stock photo standing in for one that was never picked. */}
      {hasPicture && (
        <>
          <img src={resolvedUrl} alt='' className='journal-card-bg' loading='lazy' />
          <div className='journal-card-scrim' aria-hidden='true' />
        </>
      )}
      {isNew && <span className='journal-card-new-badge'>New</span>}
      <p className='journal-card-title'>{entry.questTitle}</p>
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
//
// Viewing only: an already-saved reflection shows as plain text with no
// inline edit control — editing is reached exclusively through the 3-dot
// menu's "Edit journal entry" (see JournalCardMenu), which lives here now
// too. An entry with nothing saved yet has nothing to "view", so it opens
// straight into the write form instead.
function ExpandedJournalEntry({ entry, onClose }) {
  const [savedBody, setSavedBody] = useState(entry.reflectionBody || '');
  const [editing, setEditing] = useState(!(entry.reflectionBody || '').trim());
  const [body, setBody] = useState(entry.reflectionBody || '');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState('');
  const [pickingPicture, setPickingPicture] = useState(false);
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
        className='journal-expanded-card journal-expanded-card--entry'
        onClick={(e) => e.stopPropagation()}
      >
        <JournalCardMenu
          entry={entry}
          isEditing={editing}
          onChangePicture={() => setPickingPicture(true)}
          onEdit={() => {
            setBody(savedBody);
            setError('');
            setEditing(true);
          }}
        />
        <button
          type='button'
          className='journal-expanded-close'
          onClick={onClose}
          aria-label='Close'
        >
          <IconX width={18} height={18} />
        </button>
        <motion.div
          layoutId={`journal-content-${entry.id}`}
          initial={reduce ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.25, ease: 'easeInOut' }}
        >
          <h2 style={{ marginTop: 0, paddingRight: 40 }}>{entry.questTitle}</h2>

          <div className='journal-reflection'>
            {/* <h3>Your Reflection</h3> */}
            {editing ? (
              <>
                <p style={{ marginTop: 0 }}>
                  Here are some questions you can think about to start your reflection:
                </p>
                <ul>
                  {REFLECTION_PROMPTS.map((prompt) => (
                    <li key={prompt}>{prompt}</li>
                  ))}
                </ul>
                {/* Same borderless auto-grow trick as CreateQuestForm.jsx's
                    description field (see .quest-form-description-wrap in
                    style.css): a 1-cell grid where the textarea and a
                    hidden ::after (mirroring its value via
                    data-replicated-value) both grow together, so there's
                    no resize handle or internal scrollbar to fight — the
                    textarea just grows, and .journal-expanded-card's own
                    overflow-y:auto takes over once the card gets taller
                    than the modal can show. */}
                <div className='quest-form-description-wrap' data-replicated-value={body}>
                  <textarea
                    className='quest-form-description-input'
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder='Answer one of these, all of them, or just free-write — whatever works for you.'
                  />
                </div>
                {error && <p className='box-danger'>{error}</p>}
                <div className='flex items-center gap-sm' style={{ marginTop: 10 }}>
                  <StampButton
                    type='button'
                    variant='primary'
                    onClick={saveReflection}
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Save reflection'}
                  </StampButton>
                  {savedBody.trim() && (
                    <StampButton type='button' onClick={cancelEditing} disabled={saving}>
                      Cancel
                    </StampButton>
                  )}
                </div>
              </>
            ) : (
              <div className='journal-reflection-complete'>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{savedBody}</p>
                <AnimatePresence>
                  {justSaved && (
                    <motion.p
                      key='saved-confirmation'
                      initial={reduce ? false : { opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={reduce ? undefined : { opacity: 0 }}
                      className='journal-saved-confirmation'
                      style={{ marginTop: 12 }}
                    >
                      ✓ Saved
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Below the reflection, not above it — hidden while actively
              editing (the Save/Cancel buttons take this same bottom area
              instead). */}
          {!editing && <FeedbackStatus entry={entry} />}
        </motion.div>
      </motion.div>

      {pickingPicture && <ThumbnailPicker entry={entry} onClose={() => setPickingPicture(false)} />}
    </LightboxBackdrop>
  );
}

// The 3-dot menu's "Change background picture" destination — a simple
// modal-on-top (no shared-element concerns, unlike the expand/morph
// interaction above), so LightboxBackdrop is a direct fit as-is. Stacks on
// top of the already-open expanded card (both are just LightboxBackdrop
// portals to document.body).
function ThumbnailPicker({ entry, onClose }) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(null); // the url (or "remove"/"upload") currently being saved, or null
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

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

  async function handleFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets choosing the same file again re-fire onChange
    if (!file) return;
    setError('');
    if (!THUMBNAIL_UPLOAD_CONTENT_TYPES.includes(file.type)) {
      setError('Only JPEG, PNG, WebP, or HEIC photos are allowed.');
      return;
    }
    if (file.size > THUMBNAIL_UPLOAD_MAX_SIZE_BYTES) {
      setError('Photo must be smaller than 10MB.');
      return;
    }
    setSaving('upload');
    try {
      const ext = THUMBNAIL_UPLOAD_EXT_BY_CONTENT_TYPE[file.type] || 'jpg';
      const path = `journalThumbnails/${user.uid}/${Date.now()}.${ext}`;
      await uploadBytes(storageRef(storage, path), file, { contentType: file.type });
      const url = await getDownloadURL(storageRef(storage, path));
      await callSetJournalThumbnail({ questId: entry.id, thumbnailUrl: url });
      onClose();
    } catch (err) {
      setError(getAuthErrorMessage(err));
      setSaving(null);
    }
  }

  return (
    <LightboxBackdrop onClose={onClose} label='Choose a background picture'>
      <div
        className='journal-expanded-card'
        style={{ width: 'min(420px, 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type='button'
          className='journal-expanded-close'
          onClick={onClose}
          aria-label='Close'
        >
          <IconX width={18} height={18} />
        </button>
        <h3 style={{ marginTop: 0, paddingRight: 28 }}>Choose a background picture</h3>
        {error && <p className='box-danger'>{error}</p>}
        <input
          ref={fileInputRef}
          type='file'
          accept={THUMBNAIL_UPLOAD_CONTENT_TYPES.join(',')}
          onChange={handleFileChosen}
          style={{ display: 'none' }}
        />
        <StampButton
          type='button'
          onClick={() => fileInputRef.current?.click()}
          disabled={Boolean(saving)}
          style={{ marginBottom: 12 }}
        >
          {saving === 'upload' ? 'Uploading…' : 'Upload your own photo'}
        </StampButton>
        <div className='journal-thumbnail-picker-grid'>
          <button
            type='button'
            className='journal-thumbnail-picker-option flex items-center justify-center'
            data-selected={!entry.thumbnailUrl ? 'true' : 'false'}
            onClick={() => pick(null)}
            disabled={Boolean(saving)}
            aria-label='Remove picture'
          >
            <span className='field-optional' style={{ fontSize: '0.75rem' }}>
              {saving === 'remove' ? '...' : 'None'}
            </span>
          </button>
          {THUMBNAIL_OPTIONS.map((url) => (
            <button
              key={url}
              type='button'
              className='journal-thumbnail-picker-option'
              data-selected={entry.thumbnailUrl === url ? 'true' : 'false'}
              onClick={() => pick(url)}
              disabled={Boolean(saving)}
              aria-label='Use this picture'
            >
              <img src={url} alt='' loading='lazy' />
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
// (onSnapshot), same as the BottomNav badge and NotificationBanner's
// Home-screen notice, so a freshly-answered feedback request appears here
// without a reload.
export function Journal() {
  const { user, loading } = useAuth();
  const [entries, setEntries] = useState(null);
  const [openId, setOpenId] = useState(null);
  const reduce = useReducedMotion();
  const columnCount = useColumnCount();
  const { offsets: columnOffsets } = useParallaxColumnOffsets(
    columnCount,
    reduce || columnCount === 1 || (entries?.length ?? 0) <= 1,
  );

  useEffect(() => {
    if (!user) return undefined;
    const q = query(collection(db, 'users', user.uid, 'journal'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [user]);

  // useParallaxColumnOffsets' page-level useScroll only recalculates its
  // scrollable range on an actual scroll/resize event, not on DOM content
  // changing height by itself. Before entries load, this page is just
  // TopBar + a loading spinner — on a tall enough viewport that's often
  // exactly viewport height, i.e. zero scrollable range, and useScroll's
  // progress locks onto 1 in that edge case instead of 0. It then has no
  // reason to recompute once the real (much taller) .journal-columns grid
  // mounts, even though scrollY never actually moved — the columns render
  // pre-offset to their full parallax swing from the very first frame. A
  // synthetic resize, fired once the real content has painted at its final
  // height, gives it that reason. Re-fires on every entries change (not
  // just the first load) since the same zero-range edge case could recur
  // any time the list shrinks back down to one short entry.
  useEffect(() => {
    if (entries === null) return undefined;
    const id = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => cancelAnimationFrame(id);
  }, [entries]);

  // Round-robin distribution into N columns — see useParallaxColumnOffsets'
  // own module note on why this can't just be a CSS auto-fit grid.
  const columns = useMemo(() => {
    const cols = Array.from({ length: columnCount }, () => []);
    (entries || []).forEach((entry, i) => cols[i % columnCount].push(entry));
    return cols;
  }, [entries, columnCount]);

  const openEntry = useMemo(() => entries?.find((e) => e.id === openId), [entries, openId]);

  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to='/login' replace />;

  return (
    <PageMotion>
      <TopBar title='Journal' />
      {entries === null ? (
        <LoadingSpinner label='Loading your journal…' />
      ) : entries.length === 0 ? (
        <div className='quest-empty'>
          <h2>No Entries Yet</h2>
          <p>Check into an organization quest to start your first journal entry.</p>
        </div>
      ) : (
        <div className='journal-columns'>
          {columns.map((column, i) => (
            <motion.div key={i} className='journal-column' style={{ y: columnOffsets[i] }}>
              {column.map((entry) => (
                <JournalCard
                  key={entry.id}
                  entry={entry}
                  isOpen={openId === entry.id}
                  onOpen={() => setOpenId(entry.id)}
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
            onClose={() => setOpenId(null)}
          />
        )}
      </AnimatePresence>
    </PageMotion>
  );
}
