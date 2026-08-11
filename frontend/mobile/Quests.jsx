import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { db, storage } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { getCachedCollection } from '@shared/collectionCache.js';
import {
  callRsvpToQuest,
  callCancelRsvp,
  callGetMyReview,
  callSubmitReview,
  callGetSideQuestStatus,
  callSubmitQuestPhoto,
  callRequestQuestFeedback,
} from '@shared/fetch.jsx';
import { getAuthErrorMessage } from '@shared/authErrors.js';
import {
  groupBySeries,
  attachSeriesRatings,
  attachOrgLogos,
  isUpcoming,
  toDate,
} from '@shared/questSeries.js';
import { DuckMark } from '@shared/Logo.jsx';
import { useIsDesktop } from '@shared/useIsDesktop.js';
import { StatusStamp } from '@shared/StatusStamp.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { ImageUploadCard } from '@shared/ImageUploadCard.jsx';
import { LightboxBackdrop } from '@shared/LightboxBackdrop.jsx';
import { OrgAvatar } from '@shared/OrgAvatar.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { AddToCalendar } from '@shared/AddToCalendar.jsx';
import { LocationLink } from '@shared/LocationLink.jsx';
import { HeroCarousel } from '@shared/HeroCarousel.jsx';
import { ShareButton } from '@shared/QuestSeriesRow.jsx';
import { QuestReviewsList } from '@shared/QuestReviewsList.jsx';
import { accommodationLabel } from '@shared/accommodations.js';
import { RankProgressCard } from '@shared/RankProgressCard.jsx';
import { VanishSearchInput } from '@shared/VanishSearchInput.jsx';
import { parseSearch } from '@shared/searchTags.js';
import {
  FilterPill,
  FilterButton,
  DesktopFilterPopover,
  MobileFilterSheet,
  useFilterPanel,
} from '@shared/FilterPanel.jsx';
import {
  IconCalendar,
  IconUsers,
  IconCheck,
  IconAlert,
  IconLock,
  IconGrid,
  IconList,
} from '@shared/icons.jsx';

// Mirrors TIER_BASE_POINTS in functions/main.py — only side/neighborhood
// (isDefault) quests carry a tier; organization quests never do.
const TIER_LABELS = {
  iron: 'Iron',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  diamond: 'Diamond',
};
const TIER_POINTS = { iron: 10, bronze: 12, silver: 15, gold: 18, diamond: 20 };

// A small rounded pill, not the tier name itself — that's already implied
// by the quest (and spelled out in the lock message if it's gated, see
// sideQuestGate below), so this is just the point payoff.
function TierBadge({ tier }) {
  if (!tier || !TIER_POINTS[tier]) return null;
  return <span className='quest-points-pill'>+{TIER_POINTS[tier]} pts</span>;
}

function formatEventDate(isoOrTimestamp) {
  if (!isoOrTimestamp) return null;
  const date = isoOrTimestamp.toDate ? isoOrTimestamp.toDate() : new Date(isoOrTimestamp);
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Date only, no time — once a quest is completed, "Completed on Aug 2,
// 2026" reads better than repeating the exact start time.
function formatCompletedDate(isoOrTimestamp) {
  if (!isoOrTimestamp) return null;
  const date = isoOrTimestamp.toDate ? isoOrTimestamp.toDate() : new Date(isoOrTimestamp);
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function formatStars(rating) {
  const whole = Math.round(rating);
  return '★'.repeat(whole) + '☆'.repeat(5 - whole);
}

// Five tap targets instead of a "5 stars ▾" dropdown — one tap versus a
// two-step menu interaction, and no pre-selected value biasing the rating
// toward 5. role="radiogroup"/"radio" since exactly one of five is chosen,
// same semantics a native radio button set would have.
//
// Rating something is occasional and expressive, not routine — a good spot
// for a bit of tactile fun rather than a flat glyph swap. `initial={false}`
// keeps the pop from firing on mount (only the star that actually changes
// state should ever bounce); whileTap gives every star an even bigger
// squeeze-on-press since this is a decorative, not utilitarian, control.
function StarRatingInput({ value, onChange }) {
  const reduce = useReducedMotion();
  return (
    <div role='radiogroup' aria-label='Rating' className='star-rating-input'>
      {[1, 2, 3, 4, 5].map((n) => (
        <motion.button
          key={n}
          type='button'
          role='radio'
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          className='star-rating-btn'
          onClick={() => onChange(n)}
          initial={false}
          animate={reduce ? undefined : { scale: n === value ? [1, 1.35, 1] : 1 }}
          whileTap={reduce ? undefined : { scale: 1.3 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        >
          {n <= value ? '★' : '☆'}
        </motion.button>
      ))}
    </div>
  );
}

// A member's own review for a quest they've checked in to. Shows the
// existing review read-only if one was already submitted; otherwise a
// The "Request feedback" destination (see QuestDetailBody's Request
// Feedback button, below the Leave a review/Bonus Photo row) — this used
// to live in the journal's 3-dot menu; testing found that wasn't an
// intuitive place to look for it, so it moved here instead. There's
// nothing to show once requested (the organization's answers land back in
// the journal entry itself — see mobile/Journal.jsx's FeedbackStatus, and
// QuestDetailBody's own feedbackRequestStatus, which hides this button
// once that's set), so this is just a confirm step plus whatever error the
// server surfaces (e.g. already at the monthly cap — see
// FEEDBACK_REQUEST_MONTHLY_CAP in functions/main.py).
function RequestFeedbackForm({ questId, onRequested }) {
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState('');

  async function request() {
    setError('');
    setRequesting(true);
    try {
      await callRequestQuestFeedback(questId);
      // Flips the underlying feedbackRequestStatus the instant the request
      // succeeds, not just when this modal eventually closes — otherwise
      // dismissing it (the X button) right after a successful request
      // would leave the Request Feedback button back on the page, looking
      // like nothing happened.
      onRequested();
      setRequested(true);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setRequesting(false);
    }
  }

  if (requested) {
    return (
      <div className='ink-card flex items-center gap-sm'>
        <IconCheck />
        <p style={{ margin: 0 }}>
          Feedback requested — you&rsquo;ll see the organization&rsquo;s response in your Journal
          once it&rsquo;s in.
        </p>
      </div>
    );
  }

  return (
    <div className='ink-card flex flex-col gap-md'>
      <p style={{ margin: 0 }}>
        The organization will get a short set of questions about how you did on this quest. You can
        only request feedback up to 3 times a month, and you&rsquo;ll see their response in your
        Journal once it&rsquo;s in.
      </p>
      {error && <p className='box-danger'>{error}</p>}
      <StampButton type='button' variant='primary' onClick={request} disabled={requesting}>
        {requesting ? 'Requesting...' : 'Request feedback'}
      </StampButton>
    </div>
  );
}

// submission form. submit_review itself is the source of truth on whether
// this member actually attended (checked_in) — rather than duplicating
// that check client-side, an attempt from someone who hasn't checked in
// just surfaces the server's rejection message inline, same as every other
// form here. (The caller also only renders this once it already knows the
// member checked in — see QuestDetailBody's own `checkedIn` state — this
// server check just stays as the actual source of truth.)
function QuestReview({ questId, onSubmitted }) {
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState(null);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setReview(null);
    callGetMyReview(questId)
      .then((data) => {
        if (!cancelled) {
          setReview(data.review);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Could not load your review.');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [questId]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await callSubmitReview({ questId, rating, body });
      setReview({ rating, body });
      onSubmitted?.();
    } catch (err) {
      setError(err.message || "That didn't go through — try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingSpinner label='Loading review…' />;

  if (review) {
    return (
      <div className='ink-card'>
        <p style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700 }}>
          Your review: {formatStars(review.rating)}
        </p>
        <p style={{ margin: '6px 0 0' }}>{review.body}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className='ink-card flex flex-col gap-md'>
      <div>
        <span className='field-optional'>Rating</span>
        <StarRatingInput value={rating} onChange={setRating} />
      </div>
      <label>
        Your review
        <textarea
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder='How did it go?'
        />
      </label>
      {error && <p className='box-danger'>{error}</p>}
      <StampButton type='submit' variant='primary' disabled={submitting}>
        {submitting ? 'Submitting…' : 'Submit review'}
      </StampButton>
    </form>
  );
}

const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
const EXT_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

// A member's proof-of-completion (side quests: reflection + photo; org
// quests: photo only) for a quest they've accepted/checked in to. Shows the
// current Pending/Approved/Rejected status if a submission already exists,
// otherwise an upload form — behind a button + modal (matching the QR
// code/Attendees pattern in org/Quests.jsx) rather than always sitting
// inline. Same "let the server's FAILED_PRECONDITION surface inline"
// approach as QuestReview above — this doesn't duplicate the "have you
// actually accepted/checked in" check client-side.
//
// Side quests (isDefault) additionally require a written reflection
// alongside the photo — organization quests skip that (there's no
// reflection field at all). Side quests used to gate the form behind a
// separate inline "Mark as complete" card, on top of the modal's own
// trigger button; that's gone now — the trigger button itself ("Mark as
// complete" before anything's submitted) already is that confirmation, so
// clicking it opens the modal straight to the reflection/photo form.
//
// `onStatusChange` (optional) reports the submission's status (or null)
// up to the caller as it loads/changes — QuestDetailBody uses this for
// side quests to hide "Leave quest" once the photo's been approved,
// without a second Firestore listener on the same document.
function QuestPhotoSubmission({ questId, userId, isDefault, onStatusChange }) {
  const [submission, setSubmission] = useState(undefined); // undefined = loading, null = none yet
  const [file, setFile] = useState(null);
  const [submittedPhotoUrl, setSubmittedPhotoUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [reflection, setReflection] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    setSubmission(undefined);
    setFile(null);
    setError('');
    setReflection('');
    return onSnapshot(
      doc(db, 'photoSubmissions', `${questId}_${userId}`),
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        setSubmission(data);
        onStatusChange?.(data?.status || null);
      },
      (err) => {
        setError(err.message || 'Could not load your photo submission.');
        setSubmission(null);
        onStatusChange?.(null);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questId, userId]);


  // Once a submission exists (pending/approved/rejected), fetch the actual
  // uploaded photo itself so it's visible here too, not just its status.
  useEffect(() => {
    if (!submission?.storagePath) {
      setSubmittedPhotoUrl(null);
      return;
    }
    let cancelled = false;
    getDownloadURL(storageRef(storage, submission.storagePath))
      .then((url) => {
        if (!cancelled) setSubmittedPhotoUrl(url);
      })
      .catch(() => {
        if (!cancelled) setSubmittedPhotoUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [submission?.storagePath]);

  async function submit(e) {
    e.preventDefault();
    if (!file) return;
    setError('');
    if (isDefault && !reflection.trim()) {
      setError('A short reflection is required to submit this side quest.');
      return;
    }
    if (!PHOTO_CONTENT_TYPES.includes(file.type)) {
      setError('Only JPEG, PNG, WebP, or HEIC photos are allowed.');
      return;
    }
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      setError('Photo must be smaller than 10MB.');
      return;
    }
    setUploading(true);
    try {
      const ext = EXT_BY_CONTENT_TYPE[file.type] || 'jpg';
      const storagePath = `photoSubmissions/${questId}_${userId}/${Date.now()}.${ext}`;
      await uploadBytes(storageRef(storage, storagePath), file, { contentType: file.type });
      await callSubmitQuestPhoto({
        questId,
        storagePath,
        contentType: file.type,
        reflection: isDefault ? reflection.trim() : undefined,
      });
      setFile(null);
      setReflection('');
    } catch (err) {
      setError(err.message || "That didn't go through — try again in a moment.");
    } finally {
      setUploading(false);
    }
  }

  // The button below already reflects "not loaded yet" by just not
  // rendering — there's nothing to click through to until the status is
  // known, for either kind of quest now.
  if (submission === undefined) return null;

  let content;
  if (submission && (submission.status === 'pending' || submission.status === 'approved')) {
    content = (
      <div className='ink-card flex flex-col gap-sm'>
        <p style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700 }}>
          {isDefault ? 'Proof photo' : 'Bonus photo'}
        </p>
        {!isDefault && (
          <p className='field-optional' style={{ margin: 0 }}>
            You're already checked in for this quest — this is just an extra bonus, not proof of attendance.
          </p>
        )}
        {submittedPhotoUrl && (
          <img
            src={submittedPhotoUrl}
            alt='Your submitted proof'
            style={{ maxWidth: '100%', borderRadius: 'var(--radius)' }}
          />
        )}
        {submission.reflection && <p style={{ margin: 0 }}>{submission.reflection}</p>}
        <StatusStamp tone={submission.status === 'approved' ? 'education' : 'outdoors'}>
          {submission.status === 'approved' ? 'Approved' : 'Pending review'}
        </StatusStamp>
        {submission.status === 'approved' && (
          <p style={{ margin: 0 }}>
            +{submission.pointsAwarded} {isDefault ? 'points earned' : 'bonus points earned'}
          </p>
        )}
      </div>
    );
  } else {
    // Covers both "never submitted" and "rejected, resubmitting" — for a
    // side quest, clicking the outer "Mark as complete" trigger (see the
    // button below) already is the confirmation that used to be a separate
    // inline gate card, so this form is what opens straight away.
    content = (
      <form onSubmit={submit} className='ink-card flex flex-col gap-md'>
        <p style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700 }}>
          {isDefault ? 'Reflection & photo' : 'Bonus photo'}
        </p>
        {!isDefault && submission?.status !== 'rejected' && (
          <p className='field-optional' style={{ margin: 0 }}>
            Optional — you're already checked in. Submitting a photo just adds bonus points on top,
            it doesn't affect your attendance.
          </p>
        )}
        {submission?.status === 'rejected' && (
          <>
            {submittedPhotoUrl && (
              <img
                src={submittedPhotoUrl}
                alt='Your rejected submission'
                style={{ maxWidth: '100%', borderRadius: 'var(--radius)' }}
              />
            )}
            {submission.reflection && <p style={{ margin: 0 }}>{submission.reflection}</p>}
            <StatusStamp tone='rejected'>Rejected</StatusStamp>
            {submission.rejectionReason && (
              <p style={{ margin: 0 }}>{submission.rejectionReason}</p>
            )}
          </>
        )}
        {isDefault && (
          <label>
            Your reflection
            <textarea
              required
              value={reflection}
              onChange={(e) => setReflection(e.target.value)}
              placeholder='What did you do, and how did it go?'
            />
          </label>
        )}
        <ImageUploadCard
          title={submission?.status === 'rejected' ? 'Submit a new photo' : 'Upload a photo'}
          accept={PHOTO_CONTENT_TYPES.join(',')}
          onUpload={(url, selectedFile) => setFile(selectedFile)}
          onRemove={() => setFile(null)}
        />
        {error && <p className='box-danger'>{error}</p>}
        <StampButton
          type='submit'
          variant='primary'
          disabled={!file || uploading || (isDefault && !reflection.trim())}
        >
          {uploading ? 'Uploading…' : isDefault ? 'Submit completion' : 'Submit photo'}
        </StampButton>
      </form>
    );
  }

  const statusLabel =
    submission?.status === 'approved'
      ? 'Approved'
      : submission?.status === 'rejected'
        ? 'Rejected — resubmit'
        : 'Pending review';

  return (
    // A wrapping div, not a bare fragment — the org-quest trigger sits
    // inside .quest-actions (a row flex container), but the side-quest one
    // is still a direct child of the column-flex .quest-card-body (default
    // align-items: stretch), which would stretch a bare button to fill the
    // row's full width. The div absorbs that; .quest-card-body's own gap
    // already spaces it out from its siblings, so no margin is needed here.
    <div>
      {/* Once something's been submitted, a small thumbnail of the actual
          photo is a more honest trigger than a generic full-width button —
          it's showing you what you turned in, not just offering an action. */}
      {submission ? (
        <button type='button' className='quest-proof-thumb-btn' onClick={() => setModalOpen(true)}>
          {submittedPhotoUrl ? (
            <img src={submittedPhotoUrl} alt='' className='quest-proof-thumb-img' />
          ) : (
            <span className='quest-proof-thumb-img' aria-hidden='true' />
          )}
          <span>{statusLabel}</span>
        </button>
      ) : (
        <StampButton type='button' variant='primary' onClick={() => setModalOpen(true)}>
          {isDefault ? 'Mark as complete' : 'Submit Bonus Photo'}
        </StampButton>
      )}
      {modalOpen && (
        <LightboxBackdrop onClose={() => setModalOpen(false)} label={isDefault ? 'Proof photo' : 'Bonus photo'}>
          {/* No outer ink-card here — `content` already supplies its own
              (see above), and nesting two would double the border/padding.
              This wrapper is just the modal's sizing/scroll constraint. */}
          <div className='detail-modal-content' data-frame='cozy' onClick={(e) => e.stopPropagation()}>
            <div className='detail-modal-content-scroll'>{content}</div>
          </div>
        </LightboxBackdrop>
      )}
    </div>
  );
}

// The full body of a quest's detail: date/location/capacity, description,
// tags, and the RSVP/QR/review actions. Rendered exactly once at a time —
// inline under its row on mobile, or in the side panel on desktop — so its
// own lazily-fetched sub-state (QR, review) never double-fetches. Exported
// so the standalone Quest Details page (see frontend/app/src/QuestDetails.jsx)
// can reuse this exact body instead of duplicating it.
export function QuestDetailBody({
  series,
  userId,
  canRsvp,
  busyId,
  onToggleRsvp,
  gate,
  onGoToOrgQuests,
  onGuestRsvp,
  showTitle = false,
}) {
  const { primary, occurrences } = series;
  const [selectedId, setSelectedId] = useState(occurrences[0].id);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [requestFeedbackOpen, setRequestFeedbackOpen] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);
  // Side quests only — reported up from QuestPhotoSubmission's own
  // photoSubmissions listener (see its onStatusChange prop) so "Leave
  // quest" can hide once the photo's approved, without a second listener
  // on the same document here.
  const [sidePhotoStatus, setSidePhotoStatus] = useState(null);
  const reduce = useReducedMotion();

  // Reset to the first occurrence and collapse any open sub-panels whenever
  // a different series is shown in this slot (desktop: clicking a new row
  // reuses this same mounted component rather than remounting it).
  useEffect(() => {
    setSelectedId(occurrences[0].id);
    setReviewModalOpen(false);
    setRequestFeedbackOpen(false);
    setSidePhotoStatus(null);
  }, [series.seriesId]);

  // Hero (HeroCarousel.jsx) mixes the org's general Community Photos
  // gallery (org.photos) with this specific series' own coverPhotos — only
  // fetched for the standalone detail view (showTitle), matching where the
  // map's own quest detail (MapQuestDetailBody.jsx) shows the same
  // carousel. Side quests have no orgId, so this just stays null and
  // HeroCarousel falls back to series.coverPhotos alone, then its plain
  // DuckMark placeholder if that's empty too.
  const [orgMedia, setOrgMedia] = useState(null);
  useEffect(() => {
    if (!showTitle || !primary.orgId) {
      setOrgMedia(null);
      return undefined;
    }
    let cancelled = false;
    getDoc(doc(db, 'organizations', primary.orgId))
      .then((snap) => {
        if (!cancelled) setOrgMedia(snap.exists() ? snap.data() : null);
      })
      .catch(() => {
        if (!cancelled) setOrgMedia(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showTitle, primary.orgId]);

  const selected = occurrences.find((o) => o.id === selectedId) || occurrences[0];
  const rsvpCount = (selected.rsvpd || []).length;
  const isRsvpd = (selected.rsvpd || []).includes(userId);
  const isFull = selected.capacity != null && rsvpCount >= selected.capacity && !isRsvpd;

  // A one-shot confirmation, not a permanent label — without this,
  // "You're in!"/"Accepted!" (rendered below whenever isRsvpd is true) sat
  // next to the Cancel RSVP button for as long as the RSVP itself stood,
  // rather than reading as a momentary confirmation of the action that was
  // just taken. Tracks isRsvpd's own false->true edge (a fresh RSVP, not
  // one that was already in place when this mounted) and clears itself
  // after 5s; switching occurrences/series resets it so an old date's
  // confirmation can't bleed into a newly-selected one.
  const [justRsvpd, setJustRsvpd] = useState(false);
  const wasRsvpdRef = useRef(isRsvpd);
  useEffect(() => {
    const wasRsvpd = wasRsvpdRef.current;
    wasRsvpdRef.current = isRsvpd;
    if (!wasRsvpd && isRsvpd) {
      setJustRsvpd(true);
      const timer = setTimeout(() => setJustRsvpd(false), 5000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isRsvpd]);
  useEffect(() => {
    setJustRsvpd(false);
    wasRsvpdRef.current = false;
  }, [selectedId, series.seriesId]);
  // Org quest, checked in — the completed/attended state: date/spots/
  // accessibility/RSVP all give way to a plain "Completed on …" line and
  // the review/bonus-photo actions. Side quests never set this (checkedIn
  // is always false for them — see the effect below).
  const isCompleted = !primary.isDefault && checkedIn;

  // Review/Bonus Photo (org quests only — see each render site below) only
  // ever mean anything once this member has actually checked in, not just
  // RSVP'd — the same `attendance/{questId}_{uid}` doc submit_review and
  // submit_quest_photo already gate on server-side (a doc existing there IS
  // "checked in", see check_in_to_event). Side quests skip this entirely:
  // their own photo submission is gated on RSVP status server-side instead,
  // not attendance, so there's nothing to check here for them.
  useEffect(() => {
    if (primary.isDefault || !userId || !selected?.id) {
      setCheckedIn(false);
      return undefined;
    }
    let cancelled = false;
    getDoc(doc(db, 'attendance', `${selected.id}_${userId}`))
      .then((snap) => {
        if (!cancelled) setCheckedIn(snap.exists());
      })
      .catch(() => {
        if (!cancelled) setCheckedIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, [primary.isDefault, selected?.id, userId]);

  // Whether feedback has already been requested for this occurrence — a
  // journal entry (users/{uid}/journal/{questId}) already exists the
  // moment check-in happens (see check_in_to_event), so this is safe to
  // read as soon as checkedIn is true. Requesting feedback used to be a
  // Journal-only action; testing found that wasn't an intuitive place to
  // look for it, so the button now lives here instead — the request's
  // result still lands back in that same journal entry (see
  // mobile/Journal.jsx's FeedbackStatus).
  const [feedbackRequestStatus, setFeedbackRequestStatus] = useState(null);
  useEffect(() => {
    if (primary.isDefault || !userId || !selected?.id || !checkedIn) {
      setFeedbackRequestStatus(null);
      return undefined;
    }
    let cancelled = false;
    getDoc(doc(db, 'users', userId, 'journal', selected.id))
      .then((snap) => {
        if (!cancelled) setFeedbackRequestStatus(snap.exists() ? snap.data().requestStatus || null : null);
      })
      .catch(() => {
        if (!cancelled) setFeedbackRequestStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [primary.isDefault, selected?.id, userId, checkedIn]);

  // Whether this member has already reviewed this quest — "Leave a
  // review" shouldn't still read as an open action once one exists (the
  // review itself is still visible via QuestReviewsList below, and
  // re-opening the modal after submitting would just show the same
  // read-only "Your review: ★★★★☆" card QuestReview already renders for
  // an existing review — this just skips offering that as a fresh action).
  const [hasReview, setHasReview] = useState(false);
  useEffect(() => {
    if (primary.isDefault || !userId || !selected?.id || !checkedIn) {
      setHasReview(false);
      return undefined;
    }
    let cancelled = false;
    callGetMyReview(selected.id)
      .then((data) => {
        if (!cancelled) setHasReview(Boolean(data.review));
      })
      .catch(() => {
        if (!cancelled) setHasReview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [primary.isDefault, selected?.id, userId, checkedIn]);

  return (
    <div className='quest-card-body'>
      {showTitle && (
        <div className='quest-hero' style={{ marginBottom: 12 }}>
          <HeroCarousel
            photoPaths={[...(orgMedia?.photos || []), ...(series.coverPhotos || [])]}
            orgLogoUrl={orgMedia?.logoUrl}
          />
        </div>
      )}
      {/* Share is an organization-quest concept only (side quests have no
          individual shareable link — see SharedQuest.jsx). With a title to
          sit next to (showTitle), it shares that row instead of floating
          over the photo above; without one, it keeps the old absolute-
          positioned treatment (org/Quests.jsx's own copy of this row
          always has at least Edit/Delete, so it doesn't need this
          fallback). A grid, not flex — a flex row's align-items: center
          would center Share against the *whole* title block once it wraps
          to two lines, leaving it floating between them; grid's
          align-items: start pins it level with the title's own first
          line instead, and the fixed auto column means it never gets
          pushed onto its own line the way flexWrap: wrap could. */}
      {showTitle ? (
        <div className='quest-detail-title-row'>
          <p className='quest-title' style={{ fontSize: '1.25rem', margin: 0 }}>
            {primary.title}
          </p>
          {!primary.isDefault && (
            <ShareButton seriesId={primary.seriesId} questTitle={primary.title} iconOnly />
          )}
        </div>
      ) : (
        !primary.isDefault && (
          <div style={{ position: 'relative', minHeight: 36 }}>
            <div className='quest-detail-icon-actions'>
              <ShareButton seriesId={primary.seriesId} questTitle={primary.title} iconOnly />
            </div>
          </div>
        )
      )}
      {/* One row for whatever identity info this quest has — org name for
          an organization quest, the points pill for a side quest — rather
          than two separate rows, so the pill sits right next to the org
          name when both exist. Trust tags (Trustworthy/New Organization/
          Under Review) only show on the org's own profile page
          (OrganizationProfile.jsx) now, not here. */}
      {showTitle && (primary.orgName || primary.isDefault) && (
        <p className='quest-org-line flex items-center gap-sm' style={{ flexWrap: 'wrap' }}>
          {primary.orgName &&
            (primary.orgId ? (
              <Link to={`/organizations/${primary.orgId}`}>{primary.orgName}</Link>
            ) : (
              <span>{primary.orgName}</span>
            ))}
          {primary.isDefault && <TierBadge tier={primary.tier} />}
        </p>
      )}
      <div className='flex items-center gap-sm' style={{ flexWrap: 'wrap' }}>
        {occurrences.length > 1 ? (
          // No visible "Date" text — the calendar icon stands in for it,
          // matching the single-date branch below. A visually-hidden
          // <label> keeps the select's accessible name intact. The select
          // itself just sizes to its content/maxWidth now, rather than
          // stretching — it was only filling the row before because it sat
          // inside a flex-column <label> with the default stretch behavior.
          <>
            {primary.isDefault || isCompleted ? (
              <IconCalendar style={{ flex: 'none' }} />
            ) : (
              <AddToCalendar
                quest={selected}
                dateLabel={formatEventDate(selected.eventDate)}
                showLabel={false}
                className='quest-meta-row quest-meta-link'
                style={{ flex: 'none', display: 'inline-flex', alignItems: 'center' }}
              />
            )}
            <label className='visually-hidden' htmlFor='quest-date-select'>
              Date
            </label>
            <select
              id='quest-date-select'
              className='quest-date-select'
              style={{ flex: 'none', maxWidth: 200 }}
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setReviewModalOpen(false);
              }}
            >
              {occurrences.map((o) => (
                <option key={o.id} value={o.id}>
                  {formatEventDate(o.eventDate)}
                </option>
              ))}
            </select>
          </>
        ) : isCompleted ? (
          // Non-recurring and completed — there's only ever one date, so
          // this replaces the calendar row entirely rather than sitting
          // alongside it.
          formatCompletedDate(selected.eventDate) && (
            <p className='quest-meta-row' style={{ margin: 0 }}>
              Completed on {formatCompletedDate(selected.eventDate)}
            </p>
          )
        ) : (
          formatEventDate(selected.eventDate) &&
          (primary.isDefault ? (
            <p className='quest-meta-row' style={{ margin: 0 }}>
              <IconCalendar /> {formatEventDate(selected.eventDate)}
            </p>
          ) : (
            <AddToCalendar
              quest={selected}
              dateLabel={formatEventDate(selected.eventDate)}
              className='quest-meta-row quest-meta-link'
            />
          ))
        )}
        {!primary.isDefault && isCompleted && occurrences.length > 1 && (
          // Recurring: the picker itself stays put (still lets you switch
          // to another occurrence in the series) — only this slot swaps,
          // and only for whichever occurrence is currently selected.
          // Non-recurring already said "Completed on ..." in the date
          // slot above, so nothing repeats it here.
          <span className='field-optional'>
            Completed on {formatCompletedDate(selected.eventDate)}
          </span>
        )}
      </div>
      {/* Same as the quest's own map detail (MapQuestDetailBody.jsx) — this
          used to link to this app's own /map view instead, but from a
          quest someone's already RSVP'd to, what they want is directions
          there, not a re-pan of the in-app map. Side quests are excluded
          entirely — their "location" is a generic prompt ("Any local
          park," "Your neighborhood"), not a real address, so there's
          nowhere real for a directions link to point. */}
      {!primary.isDefault && (
        <LocationLink location={selected.location} lat={selected.lat} lng={selected.lng} />
      )}
      {/* Side quests are a personal challenge, not an event with capacity —
          there's no one else's attendance to count, so this stays an
          organization-quest-only row. Once checked in (org quests only —
          see the checkedIn effect above), capacity stops being relevant
          information too: the event already happened, or you're already
          there. */}
      {!primary.isDefault && !isCompleted && (
        <p className='quest-meta-row'>
          <IconUsers />{' '}
          {selected.capacity ? `${rsvpCount} / ${selected.capacity} spots filled` : `${rsvpCount} RSVP'd`}
        </p>
      )}
      {/* Side quests are self-directed with no physical venue, so
          accessibility accommodations only ever apply to organization
          quests — see accommodationTags' required-field validation in
          create_quest. Dropped entirely once completed — same reasoning as
          spots above. */}
      {!primary.isDefault && !isCompleted && (
        <p className='quest-meta-row'>
          {(primary.accommodationTags || []).length > 0
            ? `Accessibility: ${primary.accommodationTags.map(accommodationLabel).join(', ')}`
            : 'Accessibility information not specified.'}
        </p>
      )}
      {!primary.isDefault && !isCompleted && primary.accommodationDetails && (
        <p className='quest-meta-row field-optional' style={{ marginTop: -4 }}>
          {primary.accommodationDetails}
        </p>
      )}
      <p className='quest-description'>{primary.description}</p>
      {gate && (
        <p className='side-quest-gate' data-frame='cozy' id={`${selected.id}-gate`} role='status'>
          <IconLock /> {gate.message}
        </p>
      )}
      <div className='quest-actions'>
        {/* Canceling an RSVP for a quest you already checked in to doesn't
            make sense — the action drops away entirely once isCompleted is
            true (org quests). Side quests lose "Leave quest" the same way
            once their photo's been approved — there's nothing left to
            leave at that point either. */}
        {canRsvp && !isCompleted && !(primary.isDefault && sidePhotoStatus === 'approved') && (
          <StampButton
            type='button'
            variant={isRsvpd ? 'danger' : 'primary'}
            onClick={() => onToggleRsvp(selected)}
            disabled={busyId === selected.id || isFull || !!gate}
            aria-describedby={gate ? `${selected.id}-gate` : undefined}
          >
            {busyId === selected.id
              ? 'Saving…'
              : gate
                ? gate.type === 'locked'
                  ? 'Locked'
                  : 'Limit reached'
                : isFull
                  ? 'Full'
                  : isRsvpd
                    ? primary.isDefault
                      ? 'Leave quest'
                      : 'Cancel RSVP'
                    : primary.isDefault
                      ? 'Accept Quest'
                      : 'RSVP'}
          </StampButton>
        )}
        {gate && onGoToOrgQuests && (
          <StampButton type='button' variant='primary' onClick={onGoToOrgQuests}>
            View organization quests
          </StampButton>
        )}
        {!canRsvp && onGuestRsvp && (
          <StampButton type='button' variant='primary' onClick={onGuestRsvp}>
            {primary.isDefault ? 'Accept Quest' : 'RSVP'}
          </StampButton>
        )}
        <AnimatePresence>
          {/* justRsvpd, not isRsvpd — a 5s confirmation of the RSVP that was
              just made (see justRsvpd's own effect above), not a permanent
              label that would otherwise sit next to Cancel RSVP for as long
              as the RSVP itself stands. Not shown once completed either way
              — there's no "you're in" left to confirm, and the "Completed
              on …"/review/photo actions already say what's true now. */}
          {canRsvp && justRsvpd && busyId !== selected.id && !isCompleted && (
            <motion.span
              className='quest-rsvp-confirm'
              initial={reduce ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <IconCheck /> {primary.isDefault ? 'Accepted!' : "You're in!"}
            </motion.span>
          )}
        </AnimatePresence>
        {/* Reviews are an organization-quest concept — side quests have no
            organization to review. Gated on actually having checked in
            (not just RSVP'd) — matching what submit_review itself
            requires, so this never opens a form the server would reject.
            Bonus Photo and Request Feedback sit right beside it (not
            below, in their own blocks) so every completion action reads as
            one row. Request Feedback hides once feedbackRequestStatus is
            set — same reasoning as JournalCardMenu's old copy of this
            gate, just relocated here (see the effect above). */}
        {!primary.isDefault && canRsvp && isRsvpd && checkedIn && (
          <>
            {!hasReview && (
              <StampButton type='button' variant='primary' onClick={() => setReviewModalOpen(true)}>
                Leave a review
              </StampButton>
            )}
            <QuestPhotoSubmission questId={selected.id} userId={userId} isDefault={false} />
            {!feedbackRequestStatus && (
              <StampButton type='button' variant='primary' onClick={() => setRequestFeedbackOpen(true)}>
                Request feedback
              </StampButton>
            )}
          </>
        )}
      </div>
      {/* Same modal treatment as Bonus Photo — QuestReview already shows
          either the submission form or (once one exists) the read-only
          "Your review: ★★★★☆" card, so no separate open/closed label logic
          is needed here beyond opening/closing the modal itself. */}
      {!primary.isDefault && isRsvpd && checkedIn && reviewModalOpen && (
        <LightboxBackdrop onClose={() => setReviewModalOpen(false)} label='Review'>
          <div className='detail-modal-content' data-frame='cozy' onClick={(e) => e.stopPropagation()}>
            <div className='detail-modal-content-scroll'>
              <QuestReview questId={selected.id} onSubmitted={() => setHasReview(true)} />
            </div>
          </div>
        </LightboxBackdrop>
      )}
      {!primary.isDefault && isRsvpd && checkedIn && requestFeedbackOpen && (
        <LightboxBackdrop onClose={() => setRequestFeedbackOpen(false)} label='Request feedback'>
          <div className='detail-modal-content' data-frame='cozy' onClick={(e) => e.stopPropagation()}>
            <div className='detail-modal-content-scroll'>
              <RequestFeedbackForm
                questId={selected.id}
                onRequested={() => setFeedbackRequestStatus('pending')}
              />
            </div>
          </div>
        </LightboxBackdrop>
      )}
      {/* Side quests only here — their own photo submission is gated on
          RSVP status server-side, not attendance, so isRsvpd alone already
          matches what the backend requires. (Org quests render inside
          .quest-actions above instead, next to Leave a review.) */}
      {canRsvp && isRsvpd && primary.isDefault && (
        <QuestPhotoSubmission
          questId={selected.id}
          userId={userId}
          isDefault
          onStatusChange={setSidePhotoStatus}
        />
      )}
      {/* Hidden entirely with nothing to show — matches the quest's own map
          detail (MapQuestDetailBody.jsx), which gates its Reviews tab the
          same way. No expand/collapse toggle otherwise: shown inline,
          same as the org's own quest dashboard (org/Quests.jsx), all three
          sharing QuestReviewsList. */}
      {!primary.isDefault && series.reviewCount > 0 && (
        <div className='quest-expand-section' style={{ paddingTop: 12 }}>
          <p className='quest-title' style={{ fontSize: '0.95rem', margin: '0 0 10px' }}>Reviews</p>
          <QuestReviewsList questId={selected.id} reviewCount={series.reviewCount} />
        </div>
      )}
    </div>
  );
}

// One row per series (not per date) — a recurring quest with 8 scheduled
// occurrences shows as a single row with a date picker inside its detail,
// rather than flooding the list with 8 near-duplicate entries. RSVP only
// happens once opened (QuestDetailBody) — there's no quick-accept action on
// the collapsed card. Desktop selects the row into the adjacent
// quest-detail-pane (see Quests below); mobile instead navigates to the
// standalone /quests/:seriesId page (QuestDetails.jsx, same QuestDetailBody)
// — a tap hint replaces the chevron there since nothing expands in place
// anymore, so there's no other cue the card is tappable. Flat card (no
// timeline/thread column — that stays reserved for org/Quests.jsx's own
// quest list, which still uses it) with the org avatar inline; the avatar is
// its own independent tap target straight to /organizations/:orgId, while a
// stretched-link overlay button handles the rest of the card so the two
// don't conflict (see .quest-card-overlay/.quest-row-content in style.css).
// Side quests have no orgId, so their avatar is just decorative.
function QuestRow({ series, index, isDesktop, isActive, gate, onSelect }) {
  const { primary } = series;
  const reduce = useReducedMotion();

  return (
    <motion.li
      className='quest-row'
      initial={reduce ? false : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{
        duration: 0.3,
        ease: [0.23, 1, 0.32, 1],
        // Only the first screenful gets a staggered ripple on initial
        // load — rows scrolled to later already got a head start from
        // the `-60px` viewport margin above, so stacking more delay on
        // top of that would just make the list feel like it's lagging
        // behind the scroll instead of arriving with it.
        delay: Math.min(index, 5) * 0.04,
      }}
    >
      <div
        className='ink-card quest-content-col'
        data-active={isActive ? 'true' : undefined}
        data-gated={gate?.type}
      >
        <button
          type='button'
          className='quest-card-overlay'
          onClick={onSelect}
          aria-expanded={isDesktop ? isActive : undefined}
          aria-label={`View ${primary.title} details`}
        />
        <div className='quest-row-content'>
          {primary.orgId ? (
            <Link
              to={`/organizations/${primary.orgId}`}
              className='quest-thumb'
              aria-label={`View ${primary.orgName || 'organization'}'s profile`}
            >
              <OrgAvatar
                name={primary.orgName}
                seed={primary.orgId}
                logoUrl={series.orgLogoUrl}
                duckColorIndex={series.orgDuckColorIndex}
              />
            </Link>
          ) : (
            <span className='quest-thumb' aria-hidden='true'>
              <OrgAvatar
                name={primary.orgName}
                seed={series.seriesId}
                logoUrl={series.orgLogoUrl}
                duckColorIndex={series.orgDuckColorIndex}
                isDefault={primary.isDefault}
              />
            </span>
          )}
          <div className='quest-card-titles'>
            <p className='quest-title'>{primary.title}</p>
            {primary.description && <p className='quest-card-description'>{primary.description}</p>}
          </div>
          {!isDesktop && <span className='quest-tap-hint'>→</span>}
        </div>
      </div>
    </motion.li>
  );
}

// Client-side relevance sort — the free, no-AI counterpart to the server's
// own attendedTagCounts-driven ranking (see functions/main.py's
// _generate_quest_recommendations). Used for every side quest (never AI-
// ranked at all) and for any org quest an AI refresh hasn't covered yet
// (created since the last one, or before the account has attended enough
// quests to trigger a first refresh) — so it's worth keeping in sync with
// what the AI actually weighs: attendedTagCounts (real behavior) once
// there is any, onboarding interests only as the same cold-start fallback
// the AI prompt itself falls back to. Sums each matching tag's count
// rather than a plain overlap boolean, so a tag from five attended quests
// outweighs one from a single quest, same "most-attended first" weighting
// _generate_quest_recommendations gives Gemini.
function relevanceScore(quest, attendedTagCounts, interests) {
  const tags = quest.tags || [];
  if (attendedTagCounts && Object.keys(attendedTagCounts).length > 0) {
    return tags.reduce((sum, tag) => sum + (attendedTagCounts[tag] || 0), 0);
  }
  return tags.filter((tag) => interests.includes(tag)).length;
}

// Side quests are gated two ways, independent of each other: a tier the
// caller's rank hasn't reached yet (see unlockedTiers, sourced from
// get_side_quest_status/_unlocked_tiers in functions/main.py), or being
// full up on concurrent in-progress side quests (see atLimit/
// activeSideQuestIds/SIDE_QUEST_CONCURRENT_LIMIT there). Both are
// enforced again server-side in rsvp_to_quest — this only decides what to
// show before someone tries. Returns null for anything not gated,
// including every organization quest and every side quest already one of
// the caller's own active ones (not "additional").
export function sideQuestGate(primary, status) {
  if (!primary.isDefault || !status) return null;
  if (primary.tier && !status.unlockedTiers.includes(primary.tier)) {
    return {
      type: 'locked',
      message: `Reach ${TIER_LABELS[primary.tier] || primary.tier} rank to unlock this quest.`,
    };
  }
  if (status.atLimit && !status.activeSideQuestIds.includes(primary.id)) {
    return {
      type: 'atLimit',
      message: `You've reached your side quest limit (${status.limit} at a time). Complete one of your current side quests, or head over to organization quests to keep earning points.`,
    };
  }
  return null;
}

// Sort priority for the side-quests list (there's no Sort/My Activity/Tags
// picker for this segment — see FilterPanelContent's showOrgGroups guard):
// the caller's own current tier first (the ones actually worth doing at
// this rank), then other already-unlocked lower tiers, then locked ones
// last. unlockedTiers is cumulative and rank-ordered (see
// _unlocked_tiers in functions/main.py) — its last entry is always the
// caller's own tier. Doesn't change what's gated, only the display order;
// sideQuestGate above is still what decides locked vs joinable.
function sideQuestPriority(tier, status) {
  if (!status) return 1;
  const unlocked = status.unlockedTiers;
  if (!unlocked.includes(tier)) return 2;
  return tier === unlocked[unlocked.length - 1] ? 0 : 1;
}

const SORT_OPTIONS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'newest', label: 'Newest' },
  { value: 'soonest', label: 'Soonest' },
];

// The actual filter controls, identical on both surfaces (desktop popover
// and mobile sheet — see DesktopFilterPopover/MobileFilterSheet below);
// only the surrounding chrome differs. Activity (Past Attended/RSVP'd)
// applies to side quests too now — attendance/RSVP records don't care
// whether a quest is isDefault, so there's no real reason a side-quest-
// only view shouldn't filter by them the same way org quests do (see
// pastAttendedSeriesList/visibleSeries below). Sort is the one still
// disabled (greyed out, not removed — see sideQuests below) for side
// quests: there's no AI-recommended ordering for them, and their own
// tier-priority order (or, once Past Attended, the same recency order org
// quests use — see visibleSeries) already decides how they're arranged,
// with nothing left for Recommended/Newest/Soonest to control.
//
// Type, then Activity, then Sort — each its own labeled row (label beside
// the pills, not stacked above them), rather than jumbling Sort and
// Activity into one unlabeled group; that read faster to build but proved
// harder to scan than three plain rows. Tags used to be a group here too
// — they're searched via a #tag token in the search bar instead now (see
// VanishSearchInput/parseSearch below), not a picker in this panel.
//
// One more disabled case, independent of Side Quests: Soonest doesn't
// make sense once Past Attended is active — a past quest's date is
// already behind it, so "soonest" (nearest upcoming first) has nothing
// real left to rank — so it's disabled the same way, rather than silently
// producing a backwards-reading order (see Quests()'s own
// handleSelectActivity, which also switches away from Soonest
// automatically if it was already selected).
function FilterPanelContent({
  segment,
  onSelectSegment,
  sort,
  onSelectSort,
  activity,
  onSelectActivity,
  activeFilterCount,
  onClearAll,
}) {
  const sideQuests = segment === 'side-quests';
  return (
    <div className='quest-filter-panel'>
      <div className='quest-filter-panel-header'>
        <h2>Filters</h2>
        {activeFilterCount > 0 && (
          <button type='button' className='quest-filter-clear' onClick={onClearAll}>
            Clear all
          </button>
        )}
      </div>

      <div className='quest-filter-group quest-filter-group-inline'>
        <p className='quest-filter-group-label'>
          <IconGrid width={14} height={14} /> Type
        </p>
        <div className='quest-filter-pill-row'>
          <FilterPill selected={segment === 'org'} onClick={() => onSelectSegment('org')}>
            Quests
          </FilterPill>
          <FilterPill selected={sideQuests} onClick={() => onSelectSegment('side-quests')}>
            Side Quests
          </FilterPill>
        </div>
      </div>

      <hr className='quest-filter-divider' />

      <div className='quest-filter-group quest-filter-group-inline'>
        <p className='quest-filter-group-label'>
          <IconCheck width={14} height={14} /> Activity
        </p>
        <div className='quest-filter-pill-row'>
          <FilterPill
            selected={activity === 'past'}
            onClick={() => onSelectActivity(activity === 'past' ? null : 'past')}
          >
            Past Attended
          </FilterPill>
          <FilterPill
            selected={activity === 'mine'}
            onClick={() => onSelectActivity(activity === 'mine' ? null : 'mine')}
          >
            RSVP&rsquo;d
          </FilterPill>
        </div>
      </div>

      <hr className='quest-filter-divider' />

      <div className='quest-filter-group quest-filter-group-inline'>
        <p className='quest-filter-group-label'>
          <IconList width={14} height={14} /> Sort
        </p>
        <div className='quest-filter-pill-row'>
          {SORT_OPTIONS.map((opt) => (
            <FilterPill
              key={opt.value}
              selected={sort === opt.value}
              disabled={sideQuests || (opt.value === 'soonest' && activity === 'past')}
              onClick={() => onSelectSort(opt.value)}
            >
              {opt.label}
            </FilterPill>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Quests({ interests, name, recommendedQuestOrder, attendedTagCounts }) {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  // Read once, as the initial state below (see mobile/Home.jsx's "revisit
  // past quests"/"your RSVP'd quests" links, /quests?view=past and
  // ?view=mine) — `view` specifically stays a one-time entry point (a
  // fresh link should always win over whatever the URL otherwise says),
  // but segment/q/sort below it are also read once here and then kept in
  // sync going forward (see the effect after all filter state is
  // declared), so navigating away to a quest's detail page and back
  // restores the exact same filter/search/sort instead of resetting —
  // "back" only actually gets you back to this if the URL still carries
  // it, since a fresh mount has no other memory of what was showing.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialView = searchParams.get('view');
  const initialSegment = searchParams.get('segment');
  const initialSearch = searchParams.get('q') || '';
  const initialSort = searchParams.get('sort');
  const [seriesList, setSeriesList] = useState(null);
  // Every quest doc, unfiltered — kept alongside seriesList (which only
  // ever holds upcoming ones) purely so the Past Attended view below has
  // something to search for a past match in, without a second full-
  // collection read just for that.
  const [allQuests, setAllQuests] = useState(null);
  // The same questSeries docs load()'s upcoming list attaches ratings from
  // (attachSeriesRatings) — kept around so Past Attended, built separately
  // below, can show the same star rating a completed quest already has.
  const [seriesRatingsById, setSeriesRatingsById] = useState(null);
  // Same idea as seriesRatingsById, but for attachOrgLogos — without this,
  // Past Attended's own series (built separately below, not through
  // load()'s attachOrgLogos call) had no orgLogoUrl/orgDuckColorIndex at
  // all, so every org quest there fell back to the duck placeholder even
  // when that org actually has a real logo.
  const [orgById, setOrgById] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [openSeriesId, setOpenSeriesId] = useState(null);
  // Admin-created quests are always side/neighborhood quests (isDefault,
  // never orgId) — landing an admin on the "org" segment by default means
  // a quest they just created via the admin dashboard's "Add default
  // neighborhood quest" form appears to have vanished until they notice
  // there's a second tab. Every other role still defaults to "org". A
  // view=past/mine link always wins regardless of role — both only ever
  // exist under the org segment.
  const [segment, setSegment] = useState(
    initialSegment === 'org' || initialSegment === 'side-quests'
      ? initialSegment
      : initialView === 'past' || initialView === 'mine'
        ? 'org'
        : role === 'admin'
          ? 'side-quests'
          : 'org',
  );
  const [search, setSearch] = useState(initialSearch);
  // 'recommended'/'soonest'/'newest' apply different orderings to the same
  // upcoming org-quest list ('recommended' leaves load()'s own relevance/
  // AI-ranked sort untouched) — a true sort, always exactly one active.
  const [sort, setSort] = useState(
    initialSort === 'soonest' || initialSort === 'newest' ? initialSort : 'recommended',
  );
  // 'mine'/'past' are filters, not sorts, and now their own group (My
  // Activity) in the filter panel rather than folded into the sort
  // control — null means neither is active. They're mutually exclusive
  // (picking one clears the other) since the underlying lists can't
  // overlap: an occurrence is either upcoming-and-possibly-RSVP'd or
  // already-past-and-attended, never both. Combined with `sort` (not
  // overridden by it) — see visibleSeries below.
  const [activity, setActivity] = useState(
    initialView === 'past' || initialView === 'mine' ? initialView : null,
  );
  // Keeps the URL in sync with the filter state above (segment/search/
  // sort reflected as segment/q/sort, activity reusing the existing
  // `view` key) — `replace: true` so typing in the search box doesn't
  // spam browser history with one entry per keystroke. This is what makes
  // "back" from a quest's detail page (see QuestDetails.jsx's dynamic
  // BackLink, PreviousPathContext) land on the exact same filtered view
  // instead of a bare, reset /quests.
  useEffect(() => {
    const next = new URLSearchParams();
    if (segment) next.set('segment', segment);
    if (search.trim()) next.set('q', search);
    if (sort !== 'recommended') next.set('sort', sort);
    if (activity) next.set('view', activity);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, search, sort, activity]);
  const reduce = useReducedMotion();
  const isDesktop = useIsDesktop();
  const {
    open: filterPanelOpen,
    setOpen: setFilterPanelOpen,
    wrapRef: filterWrapRef,
    btnRef: filterBtnRef,
  } = useFilterPanel(isDesktop);

  // Attendance docs are the only record of which quests someone actually
  // checked into (vs. just RSVP'd) — same query BadgesPreview uses (see
  // Profile.jsx), keyed down to eventId -> checkedInAt for the Past
  // Attended filter below. Keeping the actual check-in timestamp (not
  // just membership in a Set) is what lets that view's "most recent
  // first" sort mean the same thing as mobile/Home.jsx's own "last
  // attended quest" — both need to agree on which occurrence was truly
  // most recent, not just whichever occurrence a series' primary
  // (earliest attended one — see groupBySeries) happens to be.
  const [attendedAtByEventId, setAttendedAtByEventId] = useState(null);
  useEffect(() => {
    if (!user) {
      setAttendedAtByEventId(null);
      return undefined;
    }
    let cancelled = false;
    getDocs(query(collection(db, 'attendance'), where('userId', '==', user.uid)))
      .then((snap) => {
        if (!cancelled) {
          setAttendedAtByEventId(new Map(snap.docs.map((d) => [d.data().eventId, d.data().checkedInAt])));
        }
      })
      .catch(() => {
        if (!cancelled) setAttendedAtByEventId(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  function load() {
    setLoadError(null);
    Promise.all([
      getCachedCollection(db, 'quests'),
      getCachedCollection(db, 'questSeries'),
      getCachedCollection(db, 'organizations'),
    ])
      .then(([questsSnap, seriesSnap, orgsSnap]) => {
        const all = questsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setAllQuests(all);
        const seriesDocsById = new Map(seriesSnap.docs.map((d) => [d.id, d.data()]));
        setSeriesRatingsById(seriesDocsById);
        const orgById = new Map(orgsSnap.docs.map((d) => [
          d.id, { logoUrl: d.data().logoUrl, duckColorIndex: d.data().duckColorIndex },
        ]));
        setOrgById(orgById);
        const grouped = attachOrgLogos(
          attachSeriesRatings(groupBySeries(all.filter(isUpcoming)), seriesDocsById),
          orgById,
        );
        grouped.sort((a, b) => {
          // Organization quests only — AI ranking is generated server-side
          // from interests/experience/volunteer history, see
          // _generate_quest_recommendations in functions/main.py. A quest
          // not yet covered by a ranking (e.g. created after the user's
          // last profile edit) falls back to the plain relevance sort
          // below, same as every side quest always does.
          if (!a.primary.isDefault && !b.primary.isDefault && recommendedQuestOrder?.length) {
            const rankA = recommendedQuestOrder.indexOf(a.primary.id);
            const rankB = recommendedQuestOrder.indexOf(b.primary.id);
            if (rankA !== -1 || rankB !== -1) {
              if (rankA === -1) return 1;
              if (rankB === -1) return -1;
              return rankA - rankB;
            }
          }
          return (
            relevanceScore(b.primary, attendedTagCounts, interests) -
            relevanceScore(a.primary, attendedTagCounts, interests)
          );
        });
        setSeriesList(grouped);
      })
      .catch((err) => {
        setLoadError(err.message || 'Could not load quests.');
      });
  }

  useEffect(load, [interests, attendedTagCounts, recommendedQuestOrder]);

  // Only "user" accounts RSVP at all, so this is the only role that needs
  // to know which side quests are locked/at-limit. Reloaded after every
  // RSVP/cancel below since taking on or freeing a side quest slot changes
  // whether the *next* one shows as gated.
  const [sideQuestStatus, setSideQuestStatus] = useState(null);
  function loadSideQuestStatus() {
    if (role !== 'user') return;
    callGetSideQuestStatus()
      .then(setSideQuestStatus)
      .catch(() => {});
  }
  useEffect(loadSideQuestStatus, [role]);

  function clearAllFilters() {
    setSort('recommended');
    setActivity(null);
    setSearch((prev) => parseSearch(prev).text);
  }

  // Soonest ("nearest upcoming first") has nothing real to rank once
  // looking at already-past quests, so switching Activity to Past
  // Attended while Soonest is the active sort backs off to Recommended
  // instead of leaving a sort selected that reads backwards against a
  // past list. FilterPanelContent also disables the Soonest pill outright
  // while Past Attended is active, so this only ever fires for
  // whatever was already selected coming in.
  function handleSelectActivity(next) {
    setActivity(next);
    if (next === 'past' && sort === 'soonest') setSort('recommended');
  }

  async function toggleRsvp(quest) {
    setBusyId(quest.id);
    try {
      if ((quest.rsvpd || []).includes(user.uid)) {
        await callCancelRsvp(quest.id);
      } else {
        await callRsvpToQuest(quest.id);
      }
      load();
      loadSideQuestStatus();
    } finally {
      setBusyId(null);
    }
  }

  const orgCount = useMemo(() => {
    if (!seriesList) return 0;
    return new Set(seriesList.filter((s) => s.primary.orgId).map((s) => s.primary.orgId)).size;
  }, [seriesList]);

  // The org / side-quests segmented toggle applies at both breakpoints —
  // "side-quests" are the admin-created neighborhood quests (isDefault, no
  // orgId; see create_default_quest in functions/main.py), "org" is
  // everything an organization posted itself. Every quest is one or the
  // other by construction, never both.
  const segmentedList = useMemo(() => {
    if (!seriesList) return [];
    return seriesList.filter((s) =>
      segment === 'side-quests' ? s.primary.isDefault : !s.primary.isDefault,
    );
  }, [seriesList, segment]);

  // Past Attended (see the activity==='past' filter below) — org quests
  // AND side quests both (attendance doesn't care whether a quest was
  // isDefault), built from allQuests (the one list load() doesn't pre-
  // filter to upcoming) crossed against attendedAtByEventId, so a quest
  // only shows here once actually checked into, not just RSVP'd and never
  // attended. Deliberately NOT also gated on !isUpcoming(q) — checking in
  // moves a quest here immediately, not whenever its own event window
  // happens to expire hours later (see the "mine" branch of visibleSeries
  // below, which is the other half of this: an attended occurrence has to
  // disappear from RSVP'd at the same moment it appears here, or it'd
  // briefly sit in both). Segment-filtered same as segmentedList below, at
  // the point it's actually used (visibleSeries) — not here, so this one
  // list can still serve either segment without rebuilding it per-segment.
  const pastAttendedSeriesList = useMemo(() => {
    if (!allQuests || !attendedAtByEventId) return [];
    const attended = allQuests.filter((q) => attendedAtByEventId.has(q.id));
    return attachOrgLogos(
      attachSeriesRatings(groupBySeries(attended), seriesRatingsById || new Map()),
      orgById || new Map(),
    );
  }, [allQuests, attendedAtByEventId, seriesRatingsById, orgById]);

  // No longer a picker in the filter panel (see FilterPanelContent) — just
  // the pool of real tag values #-search can match against, and the
  // source for the search bar's rotating "Try #___" placeholder hints.
  const availableTags = useMemo(() => {
    const seen = new Set();
    segmentedList.forEach((s) => (s.primary.tags || []).forEach((t) => seen.add(t)));
    return [...seen];
  }, [segmentedList]);

  // What VanishSearchInput's placeholder cycles through — a plain "Search"
  // first, then a few real tags as "Try #___" hints, teaching the #tag
  // syntax without a dedicated help string. Capped at 4 so it doesn't take
  // forever to cycle back around on a heavily-tagged segment.
  const searchPlaceholders = useMemo(
    () => ['Search', ...availableTags.slice(0, 4).map((tag) => `Try #${tag}`)],
    [availableTags],
  );

  // Sort now always controls ordering (see FilterPanelContent's Sort
  // group) — Activity (Past Attended/RSVP'd) is a pure filter on top of
  // it, not its own ordering override the way the old single dropdown's
  // 'mine'/'past' options were. The one exception: Recommended has no
  // real meaning for a past-attended list (there's no relevance ranking
  // to fall back on — pastAttendedSeriesList isn't built through the same
  // AI-ranked load() path segmentedList is), so Recommended + Past
  // Attended falls back to the same "most recently attended first" order
  // the old dedicated 'past' sort used, rather than an arbitrary one.
  const { tags: searchTags, text: searchText } = useMemo(() => parseSearch(search), [search]);

  const activeFilterCount =
    (sort !== 'recommended' ? 1 : 0) + (activity ? 1 : 0) + (searchTags.length > 0 ? 1 : 0);

  const visibleSeries = useMemo(() => {
    let list;
    if (activity === 'past') {
      list = pastAttendedSeriesList.filter((s) =>
        segment === 'side-quests' ? s.primary.isDefault : !s.primary.isDefault,
      );
    } else if (activity === 'mine') {
      // An occurrence someone's already checked into belongs in Past
      // Attended now, not here (see pastAttendedSeriesList's own note) —
      // excluded the moment attendedAtByEventId has it, regardless of
      // whether its own event window has technically expired yet.
      list = segmentedList.filter((s) =>
        s.occurrences.some(
          (o) => (o.rsvpd || []).includes(user?.uid) && !attendedAtByEventId?.has(o.id),
        ),
      );
    } else {
      // Default browsing view — a one-off quest already RSVP'd to (or
      // already attended, e.g. checked in before its own eventDate) has
      // nothing left to "explore": nobody needs it competing for space
      // with quests they haven't acted on yet, and it's still reachable
      // via the Activity filter above. A *recurring* series stays,
      // regardless of any one occurrence's own RSVP/attended status — it
      // almost certainly still has other upcoming dates worth seeing,
      // and recurrenceFrequency (not occurrence count) is what actually
      // marks it recurring, not incidentally down to its last date.
      list = segmentedList.filter((s) => {
        if (s.primary.recurrenceFrequency) return true;
        const occurrence = s.primary;
        const alreadyRsvpd = (occurrence.rsvpd || []).includes(user?.uid);
        const alreadyAttended = attendedAtByEventId?.has(occurrence.id);
        return !alreadyRsvpd && !alreadyAttended;
      });
    }

    if (searchTags.length > 0) {
      list = list.filter((s) => (s.primary.tags || []).some((t) => searchTags.includes(t.toLowerCase())));
    }
    const q = searchText.toLowerCase();
    if (q) {
      list = list.filter((s) => {
        const { title, orgName, location } = s.primary;
        return [title, orgName, location].some((field) => (field || '').toLowerCase().includes(q));
      });
    }
    if (segment === 'side-quests' && activity !== 'past') {
      // Tier priority always wins for side quests — except once looking at
      // already-attended ones, where "worth doing at this rank" has
      // nothing left to rank; that case falls through to the same
      // recency order org quests' Past Attended uses (see below).
      list = [...list].sort(
        (a, b) => sideQuestPriority(a.primary.tier, sideQuestStatus) - sideQuestPriority(b.primary.tier, sideQuestStatus),
      );
    } else if (sort === 'soonest') {
      // No date (a dateless side quest) sorts last, not first — there's no
      // "soonest" to compare it against.
      list = [...list].sort((a, b) => {
        const aTime = a.primary.eventDate ? toDate(a.primary.eventDate).getTime() : Infinity;
        const bTime = b.primary.eventDate ? toDate(b.primary.eventDate).getTime() : Infinity;
        return aTime - bTime;
      });
    } else if (sort === 'newest') {
      list = [...list].sort((a, b) => {
        const aTime = a.primary.createdAt ? toDate(a.primary.createdAt).getTime() : 0;
        const bTime = b.primary.createdAt ? toDate(b.primary.createdAt).getTime() : 0;
        return bTime - aTime;
      });
    } else if (activity === 'past') {
      // Recommended's fallback for Past Attended — most recently attended
      // first, by each series' own most recent checkedInAt (not
      // primary.eventDate, the series' EARLIEST occurrence — see
      // groupBySeries). A recurring series someone's attended more than
      // once would otherwise sort by its oldest visit instead of its most
      // recent one, disagreeing with mobile/Home.jsx's own "last attended
      // quest" link, which goes by checkedInAt too.
      const mostRecentCheckIn = (series) =>
        Math.max(
          ...series.occurrences.map((o) => {
            const checkedInAt = attendedAtByEventId?.get(o.id);
            return checkedInAt ? toDate(checkedInAt).getTime() : -Infinity;
          }),
        );
      list = [...list].sort((a, b) => mostRecentCheckIn(b) - mostRecentCheckIn(a));
    }
    return list;
  }, [
    segmentedList,
    pastAttendedSeriesList,
    searchTags,
    searchText,
    sort,
    activity,
    segment,
    sideQuestStatus,
    user,
    attendedAtByEventId,
  ]);

  const activeSeriesId = isDesktop ? (openSeriesId ?? visibleSeries[0]?.seriesId ?? null) : null;
  const activeSeries = visibleSeries.find((s) => s.seriesId === activeSeriesId) || null;

  if (loadError) {
    return (
      <div className='ink-card quest-empty quest-error'>
        <IconAlert />
        <h2>Couldn't load quests</h2>
        <p>{loadError}</p>
        <StampButton type='button' variant='primary' onClick={load} style={{ marginTop: 8 }}>
          Try again
        </StampButton>
      </div>
    );
  }

  if (!seriesList) return <LoadingSpinner label='Loading quests…' />;

  if (seriesList.length === 0) {
    return (
      <div className='quest-empty'>
        <DuckMark size={96} />
        <h2>Nothing here yet</h2>
        <p className='duck-caption'>Organizations are just getting started — I&rsquo;ll let you know the second one posts.</p>
      </div>
    );
  }

  const firstName = name ? name.split(' ')[0] : null;

  return (
    <div className={isDesktop ? 'quest-feed-layout' : undefined}>
      <div className='quest-feed-main'>
        <div className='quest-feed-greeting'>
          <h1>
            {activity === 'mine'
              ? segment === 'side-quests'
                ? "RSVP'd Side Quests"
                : "RSVP'd Quests"
              : activity === 'past'
                ? segment === 'side-quests'
                  ? 'Past Attended Side Quests'
                  : 'Past Attended Quests'
                : segment === 'side-quests'
                  ? 'Explore Side Quests'
                  : 'Explore Quests'}
          </h1>
        </div>

        {/* pending_org only — not 'user' too, unlike main's version of this
            widget. 'user' already sees RankProgressCard on their own
            mobile/Home.jsx landing page (this branch splits that role's
            home screen out from the quest feed); pending_org has no
            equivalent separate landing page (see App.jsx's PublicHome —
            that role isn't part of this redesign pass and still lands
            directly on this same quest feed, banner and all), so this is
            the only place they'd ever see their rank/points otherwise. */}
        {role === 'pending_org' && (
          <div style={{ marginBottom: 16 }}>
            <RankProgressCard />
          </div>
        )}

        {role === 'admin' && (
          <div className='stat-hero-row'>
            <div className='stat-hero-tile' style={{ background: 'var(--brand-green)', color: 'var(--line)' }}>
              <span className='stat-hero-number'>{seriesList.length}</span>
              <span className='stat-hero-label'>Quests Open</span>
            </div>
            <div className='stat-hero-tile' style={{ background: 'var(--brand-blue)', color: '#ffffff' }}>
              <span className='stat-hero-number'>{orgCount}</span>
              <span className='stat-hero-label'>Organizations</span>
            </div>
          </div>
        )}

        <div className='quest-search-row'>
          <VanishSearchInput
            value={search}
            onChange={setSearch}
            placeholders={searchPlaceholders}
            ariaLabel='Search quests'
          />
          {/* Replaces the old standalone Side Quest toggle pill and the
              sort dropdown + tag row below it with one consolidated
              Filters button — Type/Sort/My Activity live in one panel now
              (see FilterPanelContent), opened here. Tags moved into the
              search bar itself instead (see #tag in VanishSearchInput's
              placeholder hints and parseSearch above). */}
          <div className='quest-filter-wrap' ref={filterWrapRef}>
            <FilterButton
              btnRef={filterBtnRef}
              open={filterPanelOpen}
              onToggle={() => setFilterPanelOpen((o) => !o)}
              activeCount={activeFilterCount}
            />
            {filterPanelOpen && isDesktop && (
              <DesktopFilterPopover>
                <FilterPanelContent
                  segment={segment}
                  onSelectSegment={(next) => {
                    setSegment(next);
                    setSearch((prev) => parseSearch(prev).text);
                  }}
                  sort={sort}
                  onSelectSort={setSort}
                  activity={activity}
                  onSelectActivity={handleSelectActivity}
                  activeFilterCount={activeFilterCount}
                  onClearAll={clearAllFilters}
                />
              </DesktopFilterPopover>
            )}
          </div>
        </div>

        {filterPanelOpen && !isDesktop && (
          <MobileFilterSheet onClose={() => setFilterPanelOpen(false)}>
            <FilterPanelContent
              segment={segment}
              onSelectSegment={(next) => {
                setSegment(next);
                setSearch((prev) => parseSearch(prev).text);
              }}
              sort={sort}
              onSelectSort={setSort}
              activity={activity}
              onSelectActivity={handleSelectActivity}
              activeFilterCount={activeFilterCount}
              onClearAll={clearAllFilters}
            />
          </MobileFilterSheet>
        )}

        {visibleSeries.length === 0 ? (
          <div className='quest-empty'>
            <p>No quests match that filter.</p>
            {(activeFilterCount > 0 || search.trim()) && (
              <StampButton
                type='button'
                onClick={() => {
                  clearAllFilters();
                  setSearch('');
                }}
              >
                Clear filters
              </StampButton>
            )}
          </div>
        ) : (
          <ul className='quest-list'>
            {visibleSeries.map((series, index) => {
              const gate = sideQuestGate(series.primary, sideQuestStatus);
              return (
                <QuestRow
                  key={series.seriesId}
                  series={series}
                  index={index}
                  isDesktop={isDesktop}
                  isActive={isDesktop && activeSeriesId === series.seriesId}
                  gate={gate}
                  onSelect={() =>
                    isDesktop
                      ? setOpenSeriesId(series.seriesId)
                      : navigate(`/quests/${series.seriesId}`)
                  }
                />
              );
            })}
          </ul>
        )}
      </div>

      {isDesktop && (
        <div className='ink-card quest-detail-pane' data-frame='cozy'>
          <div className='quest-detail-pane-scroll'>
            {activeSeries ? (
              <QuestDetailBody
                series={activeSeries}
                userId={user?.uid}
                canRsvp={role === 'user'}
                busyId={busyId}
                onToggleRsvp={toggleRsvp}
                gate={sideQuestGate(activeSeries.primary, sideQuestStatus)}
                onGoToOrgQuests={() => setSegment('org')}
                showTitle
              />
            ) : (
              <div className='quest-detail-empty'>
                <DuckMark size={56} />
                <p>Select a quest to see its details.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
