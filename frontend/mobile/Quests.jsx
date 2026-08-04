import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, onSnapshot } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { db, storage } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import {
  callRsvpToQuest,
  callCancelRsvp,
  callGetMyReview,
  callSubmitReview,
  callListQuestReviews,
  callGetSideQuestStatus,
  callSubmitQuestPhoto,
  callListOrganizationTrustTags,
} from '@shared/fetch.jsx';
import {
  groupBySeries,
  attachSeriesRatings,
  attachOrgTrustStatus,
  isUpcoming,
  toDate,
} from '@shared/questSeries.js';
import { DuckMark } from '@shared/Logo.jsx';
import { useIsDesktop } from '@shared/useIsDesktop.js';
import { TagStamp } from '@shared/TagStamp.jsx';
import { StatusStamp } from '@shared/StatusStamp.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { LightboxBackdrop } from '@shared/LightboxBackdrop.jsx';
import { Collapse } from '@shared/Collapse.jsx';
import { OrgAvatar } from '@shared/OrgAvatar.jsx';
import { TrustTag } from '@shared/TrustTag.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { AddToCalendar } from '@shared/AddToCalendar.jsx';
import { ShareButton } from '@shared/QuestSeriesRow.jsx';
import { accommodationLabel } from '@shared/accommodations.js';
import { RankProgressCard } from '@shared/RankProgressCard.jsx';
import {
  IconCalendar,
  IconPin,
  IconUsers,
  IconCheck,
  IconAlert,
  IconSearch,
  IconLock,
  IconChevron,
  IconX,
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
// submission form. submit_review itself is the source of truth on whether
// this member actually attended (checked_in) — rather than duplicating
// that check client-side, an attempt from someone who hasn't checked in
// just surfaces the server's rejection message inline, same as every other
// form here. (The caller also only renders this once it already knows the
// member checked in — see QuestDetailBody's own `checkedIn` state — this
// server check just stays as the actual source of truth.)
function QuestReview({ questId }) {
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
  const [localPreviewUrl, setLocalPreviewUrl] = useState(null);
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

  // A quick local preview of whichever file is currently selected, before
  // it's even uploaded — lets someone confirm they picked the right photo.
  useEffect(() => {
    if (!file) {
      setLocalPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

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
        <p style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700 }}>Proof photo</p>
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
          <p style={{ margin: 0 }}>+{submission.pointsAwarded} points earned</p>
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
          {isDefault ? 'Reflection & photo' : 'Proof photo'}
        </p>
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
        <label>
          {submission?.status === 'rejected' ? 'Submit a new photo' : 'Upload a photo'}
          <input
            type='file'
            accept='image/jpeg,image/png,image/webp,image/heic,image/heif'
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        {/* A quick local preview of whichever file is currently selected,
            before it's even uploaded — lets someone confirm they picked the
            right photo before submitting. */}
        {localPreviewUrl && (
          <img
            src={localPreviewUrl}
            alt='Selected photo preview'
            style={{ maxWidth: '100%', borderRadius: 'var(--radius)' }}
          />
        )}
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
        <StampButton type='button' onClick={() => setModalOpen(true)}>
          {isDefault ? 'Mark as complete' : 'Submit Proof Photo'}
        </StampButton>
      )}
      {modalOpen && (
        <LightboxBackdrop onClose={() => setModalOpen(false)} label='Proof photo'>
          {/* No outer ink-card here — `content` already supplies its own
              (see above), and nesting two would double the border/padding.
              This wrapper is just the modal's sizing/scroll constraint. */}
          <div className='detail-modal-content' onClick={(e) => e.stopPropagation()}>
            {content}
            <button
              type='button'
              className='photo-lightbox-close'
              onClick={() => setModalOpen(false)}
              aria-label='Close'
            >
              <IconX width={18} height={18} />
            </button>
          </div>
        </LightboxBackdrop>
      )}
    </div>
  );
}

// Every reviewer's rating/body for this quest's series — same list an org
// or admin sees on their own dashboard (list_quest_reviews has no
// ownership gate; reviews are meant to help anyone deciding whether to
// attend), fetched lazily since most cards on the list never get opened.
function QuestReviewsList({ questId }) {
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    callListQuestReviews(questId)
      .then((data) => {
        if (!cancelled) {
          setReviews(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Could not load reviews.');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [questId]);

  if (loading) return <LoadingSpinner label='Loading reviews…' />;
  if (error) return <p className='box-danger'>{error}</p>;

  return (
    <ul className='data-sublist' style={{ marginTop: 12 }}>
      {reviews.length === 0 && <li>No reviews yet.</li>}
      {reviews.map((r) => (
        <li key={`${r.uid}-${r.eventDate}`}>
          {formatStars(r.rating)} — {r.name || 'Unnamed'}
          {r.eventDate ? ` (${formatEventDate(r.eventDate)})` : ''}: {r.body}
        </li>
      ))}
    </ul>
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
  const [showReviewsList, setShowReviewsList] = useState(false);
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
    setShowReviewsList(false);
    setSidePhotoStatus(null);
  }, [series.seriesId]);

  const selected = occurrences.find((o) => o.id === selectedId) || occurrences[0];
  const rsvpCount = (selected.rsvpd || []).length;
  const isRsvpd = (selected.rsvpd || []).includes(userId);
  const isFull = selected.capacity != null && rsvpCount >= selected.capacity && !isRsvpd;
  // Org quest, checked in — the completed/attended state: date/spots/
  // accessibility/RSVP all give way to a plain "Completed on …" line and
  // the review/proof-photo actions. Side quests never set this (checkedIn
  // is always false for them — see the effect below).
  const isCompleted = !primary.isDefault && checkedIn;

  // Review/Proof Photo (org quests only — see each render site below) only
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

  return (
    <div className='quest-card-body'>
      {/* Share is an organization-quest concept only (side quests have no
          individual shareable link — see SharedQuest.jsx) — the icon row
          itself only exists when there's something to put in it, unlike
          org/Quests.jsx's own copy of this row, which always has at least
          Edit/Delete. */}
      <div style={{ position: 'relative', minHeight: !primary.isDefault ? 36 : undefined }}>
        {!primary.isDefault && (
          <div className='quest-detail-icon-actions'>
            <ShareButton seriesId={primary.seriesId} iconOnly />
          </div>
        )}
        {showTitle && (
          <div style={!primary.isDefault ? { paddingRight: 50 } : undefined}>
            <p className='quest-title' style={{ fontSize: '1.25rem' }}>
              {primary.title}
            </p>
            {/* One row for whatever identity info this quest has — org
                name (+ trust tag) for an organization quest, the points
                pill for a side quest — rather than two separate rows, so
                the pill sits right next to the org name when both exist. */}
            {(primary.orgName || primary.isDefault) && (
              <p className='quest-org-line flex items-center gap-sm' style={{ flexWrap: 'wrap' }}>
                {primary.orgName && (
                  <>
                    {primary.orgId ? (
                      <Link to={`/organizations/${primary.orgId}`}>{primary.orgName}</Link>
                    ) : (
                      <span>{primary.orgName}</span>
                    )}
                    <TrustTag status={series.orgTrustStatus} />
                  </>
                )}
                {primary.isDefault && <TierBadge tier={primary.tier} />}
              </p>
            )}
          </div>
        )}
      </div>
      {series.orgTrustStatus === 'under_review' && (
        <p className='box-danger'>
          This organization is under review for consistently low ratings — its Trust Score has not
          yet been confirmed.
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
            <IconCalendar style={{ flex: 'none' }} />
            <label className='visually-hidden' htmlFor='quest-date-select'>
              Date
            </label>
            <select
              id='quest-date-select'
              style={{ flex: 'none', maxWidth: 200 }}
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setReviewModalOpen(false);
                setShowReviewsList(false);
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
          formatEventDate(selected.eventDate) && (
            <p className='quest-meta-row' style={{ margin: 0 }}>
              <IconCalendar /> {formatEventDate(selected.eventDate)}
            </p>
          )
        )}
        {!primary.isDefault &&
          (isCompleted ? (
            // Recurring: the picker itself stays put (still lets you switch
            // to another occurrence in the series) — only this slot swaps,
            // and only for whichever occurrence is currently selected.
            // Non-recurring already said "Completed on …" in the date
            // slot above, so nothing repeats it here.
            occurrences.length > 1 && (
              <span className='field-optional'>
                Completed on {formatCompletedDate(selected.eventDate)}
              </span>
            )
          ) : (
            <AddToCalendar quest={selected} style={{ padding: '4px 10px', fontSize: '0.8rem' }} />
          ))}
      </div>
      {selected.location && (
        <Link to={`/map?seriesId=${primary.seriesId}`} className='quest-meta-row quest-meta-link'>
          <IconPin /> {selected.location}
        </Link>
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
        <p className='side-quest-gate' id={`${selected.id}-gate`} role='status'>
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
          {/* Not shown once completed — there's no "you're in" left to
              confirm, and the "Completed on …"/review/photo actions
              already say what's true now. */}
          {canRsvp && isRsvpd && busyId !== selected.id && !isCompleted && (
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
            Proof Photo sits right beside it (not below, in its own block)
            so both completion actions read as one row. */}
        {!primary.isDefault && canRsvp && isRsvpd && checkedIn && (
          <>
            <StampButton type='button' onClick={() => setReviewModalOpen(true)}>
              Leave a review
            </StampButton>
            <QuestPhotoSubmission questId={selected.id} userId={userId} isDefault={false} />
          </>
        )}
      </div>
      {/* Same modal treatment as Proof Photo — QuestReview already shows
          either the submission form or (once one exists) the read-only
          "Your review: ★★★★☆" card, so no separate open/closed label logic
          is needed here beyond opening/closing the modal itself. */}
      {!primary.isDefault && isRsvpd && checkedIn && reviewModalOpen && (
        <LightboxBackdrop onClose={() => setReviewModalOpen(false)} label='Review'>
          <div className='detail-modal-content' onClick={(e) => e.stopPropagation()}>
            <QuestReview questId={selected.id} />
            <button
              type='button'
              className='photo-lightbox-close'
              onClick={() => setReviewModalOpen(false)}
              aria-label='Close'
            >
              <IconX width={18} height={18} />
            </button>
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
      {/* Same inline-accordion treatment as org/Quests.jsx's own "View
          Reviews" section (chevron toggle + .quest-expand-section border) —
          unlike View Attendees there, this one was never converted to a
          modal, so this matches it as-is. */}
      {!primary.isDefault && (
        <div className='quest-expand-section'>
          <button
            type='button'
            className='quest-card-head'
            style={{ padding: '10px 0' }}
            onClick={() => setShowReviewsList((v) => !v)}
            aria-expanded={showReviewsList}
          >
            <span className='quest-card-titles'>View Reviews</span>
            <IconChevron className='quest-chevron' data-open={showReviewsList ? 'true' : 'false'} />
          </button>
          <Collapse open={showReviewsList}>
            <QuestReviewsList questId={selected.id} />
          </Collapse>
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
              <OrgAvatar name={primary.orgName} seed={primary.orgId} />
            </Link>
          ) : (
            <span className='quest-thumb' aria-hidden='true'>
              <OrgAvatar name={primary.orgName} seed={series.seriesId} />
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

// Client-side relevance sort: count how many of a quest's tags overlap with
// the user's own interests, sort descending. Fine at this data scale (a
// handful of seeded quests) — a real recommendation engine or a
// server-side scored query would replace this if the quest list grows.
function relevanceScore(quest, interests) {
  return (quest.tags || []).filter((tag) => interests.includes(tag)).length;
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

export function Quests({ interests, name, recommendedQuestOrder }) {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Destination for Profile's "RSVP'd Quests" preview (see Profile.jsx) —
  // shows only series the caller is RSVP'd to at least one occurrence of,
  // bypassing the org/side-quests segmented toggle entirely rather than
  // adding a third segment to it.
  const mineOnly = searchParams.get('mine') === '1';
  const [seriesList, setSeriesList] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [activeTag, setActiveTag] = useState(null);
  const [openSeriesId, setOpenSeriesId] = useState(null);
  // Admin-created quests are always side/neighborhood quests (isDefault,
  // never orgId) — landing an admin on the "org" segment by default means
  // a quest they just created via the admin dashboard's "Add default
  // neighborhood quest" form appears to have vanished until they notice
  // there's a second tab. Every other role still defaults to "org".
  const [segment, setSegment] = useState(role === 'admin' ? 'side-quests' : 'org');
  const [search, setSearch] = useState('');
  // 'recommended' leaves load()'s own sort (relevance score, or the AI-
  // generated recommendation order for org quests) untouched — this only
  // applies a *different* ordering on top when explicitly chosen, rather
  // than replacing that default sort's own logic.
  const [sortBy, setSortBy] = useState('recommended');
  const reduce = useReducedMotion();
  const isDesktop = useIsDesktop();

  function load() {
    setLoadError(null);
    Promise.all([
      getDocs(collection(db, 'quests')),
      getDocs(collection(db, 'questSeries')),
      callListOrganizationTrustTags(),
    ])
      .then(([questsSnap, seriesSnap, trustTags]) => {
        const all = questsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(isUpcoming);
        const seriesDocsById = new Map(seriesSnap.docs.map((d) => [d.id, d.data()]));
        const trustStatusByOrgId = new Map(trustTags.map((t) => [t.orgId, t.trustStatus]));
        const grouped = attachOrgTrustStatus(
          attachSeriesRatings(groupBySeries(all), seriesDocsById),
          trustStatusByOrgId,
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
          return relevanceScore(b.primary, interests) - relevanceScore(a.primary, interests);
        });
        setSeriesList(grouped);
      })
      .catch((err) => {
        setLoadError(err.message || 'Could not load quests.');
      });
  }

  useEffect(load, [interests, recommendedQuestOrder]);

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
    if (mineOnly) {
      return seriesList.filter((s) =>
        s.occurrences.some((o) => (o.rsvpd || []).includes(user?.uid)),
      );
    }
    return seriesList.filter((s) =>
      segment === 'side-quests' ? s.primary.isDefault : !s.primary.isDefault,
    );
  }, [seriesList, segment, mineOnly, user]);

  const availableTags = useMemo(() => {
    const seen = new Set();
    segmentedList.forEach((s) => (s.primary.tags || []).forEach((t) => seen.add(t)));
    return [...seen];
  }, [segmentedList]);

  const visibleSeries = useMemo(() => {
    let list = segmentedList;
    if (activeTag) list = list.filter((s) => (s.primary.tags || []).includes(activeTag));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((s) => {
        const { title, orgName, location } = s.primary;
        return [title, orgName, location].some((field) => (field || '').toLowerCase().includes(q));
      });
    }
    if (sortBy === 'soonest') {
      // No date (a dateless side quest) sorts last, not first — there's no
      // "soonest" to compare it against.
      list = [...list].sort((a, b) => {
        const aTime = a.primary.eventDate ? toDate(a.primary.eventDate).getTime() : Infinity;
        const bTime = b.primary.eventDate ? toDate(b.primary.eventDate).getTime() : Infinity;
        return aTime - bTime;
      });
    } else if (sortBy === 'newest') {
      list = [...list].sort((a, b) => {
        const aTime = a.primary.createdAt ? toDate(a.primary.createdAt).getTime() : 0;
        const bTime = b.primary.createdAt ? toDate(b.primary.createdAt).getTime() : 0;
        return bTime - aTime;
      });
    }
    return list;
  }, [segmentedList, activeTag, search, sortBy]);

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
          <h1>{mineOnly ? "Your RSVP'd quests" : `Explore Quests`}</h1>
          {/* {!mineOnly && (
            <p>
              {seriesList.length} quest{seriesList.length === 1 ? '' : 's'} open — here's what's
              happening nearby.
            </p>
          )} */}
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
          <div className='search-field'>
            <IconSearch />
            <input
              type='search'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Search'
              aria-label='Search quests'
            />
          </div>
          {/* The org/side-quests switch (previously a two-option segmented
              tab) is now a single toggle pill whose label names the OTHER
              view, matching the wireframe's one "Side Quest" button. */}
          {!mineOnly && (
            <StampButton
              type='button'
              onClick={() => {
                setSegment((s) => (s === 'org' ? 'side-quests' : 'org'));
                setActiveTag(null);
              }}
            >
              {segment === 'org' ? 'Side Quest' : 'Quests'}
            </StampButton>
          )}
        </div>

        {/* "Recommended" is load()'s own relevance/AI-ranked order (see
            there) — the other two options apply a straightforward sort on
            top instead. Shares a row with the tag chips, matching the
            wireframe's single filter-pill line. */}
        {!mineOnly && (
          <div className='tag-filter-row'>
            <label className='visually-hidden' htmlFor='quest-sort-by'>
              Sort by
            </label>
            <select
              id='quest-sort-by'
              className='quest-sort-select'
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value='recommended'>Recommended</option>
              <option value='soonest'>Soonest</option>
              <option value='newest'>Newest</option>
            </select>
            {availableTags.length > 0 && (
              <>
                <TagStamp
                  selectable
                  selected={activeTag === null}
                  onClick={() => setActiveTag(null)}
                >
                  All
                </TagStamp>
                {availableTags.map((tag) => (
                  <TagStamp
                    key={tag}
                    tone={tag}
                    selectable
                    selected={activeTag === tag}
                    onClick={() => setActiveTag(tag)}
                  >
                    {tag}
                  </TagStamp>
                ))}
              </>
            )}
          </div>
        )}

        {visibleSeries.length === 0 ? (
          <p>Nothing matches that — try widening your filters.</p>
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
        <div className='ink-card quest-detail-pane'>
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
      )}
    </div>
  );
}
