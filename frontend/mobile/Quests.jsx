import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, getDocs, onSnapshot } from 'firebase/firestore';
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
} from '@shared/fetch.jsx';
import { groupBySeries, attachSeriesRatings, formatRecurrence, isUpcoming } from '@shared/questSeries.js';
import { DuckMark } from '@shared/Logo.jsx';
import { useIsDesktop } from '@shared/useIsDesktop.js';
import { TagStamp } from '@shared/TagStamp.jsx';
import { StatusStamp } from '@shared/StatusStamp.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { OrgAvatar } from '@shared/OrgAvatar.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { AddToCalendar } from '@shared/AddToCalendar.jsx';
import { ShareQuestBox } from '@shared/QuestSeriesRow.jsx';
import { accommodationLabel } from '@shared/accommodations.js';
import { IconChevron, IconCalendar, IconPin, IconUsers, IconCheck, IconAlert, IconSearch, IconLock } from '@shared/icons.jsx';

// Mirrors TIER_BASE_POINTS in functions/main.py — only side/neighborhood
// (isDefault) quests carry a tier; organization quests never do.
const TIER_LABELS = { iron: 'Iron', bronze: 'Bronze', silver: 'Silver', gold: 'Gold', diamond: 'Diamond' };
const TIER_POINTS = { iron: 10, bronze: 12, silver: 15, gold: 18, diamond: 20 };

function TierBadge({ tier }) {
  if (!tier || !TIER_LABELS[tier]) return null;
  return (
    <span
      className="quest-tier-badge"
      style={{ '--rank-color': `var(--rank-${tier})`, '--rank-ink': `var(--rank-${tier}-ink)` }}
    >
      {TIER_LABELS[tier]} &middot; {TIER_POINTS[tier]} pts
    </span>
  );
}

function formatEventDate(isoOrTimestamp) {
  if (!isoOrTimestamp) return null;
  const date = isoOrTimestamp.toDate ? isoOrTimestamp.toDate() : new Date(isoOrTimestamp);
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatStars(rating) {
  const whole = Math.round(rating);
  return '★'.repeat(whole) + '☆'.repeat(5 - whole);
}

// A member's own review for a quest they've RSVP'd to. Shows the existing
// review read-only if one was already submitted; otherwise a submission
// form. submit_review itself is the source of truth on whether this member
// actually attended (checked_in) — rather than duplicating that check
// client-side, an attempt from someone who hasn't checked in just surfaces
// the server's rejection message inline, same as every other form here.
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
      setError(err.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingSpinner label="Loading review..." />;

  if (review) {
    return (
      <div className="ink-card" style={{ marginTop: 12 }}>
        <p style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700 }}>
          Your review: {formatStars(review.rating)}
        </p>
        <p style={{ margin: '6px 0 0' }}>{review.body}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="ink-card flex flex-col gap-md" style={{ marginTop: 12 }}>
      <label>
        Rating
        <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} star{n === 1 ? '' : 's'}
            </option>
          ))}
        </select>
      </label>
      <label>
        Your review
        <textarea required value={body} onChange={(e) => setBody(e.target.value)} placeholder="How did it go?" />
      </label>
      {error && <p className="box-danger">{error}</p>}
      <StampButton type="submit" variant="primary" disabled={submitting}>
        {submitting ? 'Submitting...' : 'Submit review'}
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
// otherwise an upload form. Same "let the server's FAILED_PRECONDITION
// surface inline" approach as QuestReview above — this doesn't duplicate
// the "have you actually accepted/checked in" check client-side.
//
// Side quests (isDefault) additionally gate the form behind an explicit
// "Mark as complete" step and require a written reflection alongside the
// photo — organization quests skip both (the form shows immediately, same
// as before this existed, and there's no reflection field at all).
function QuestPhotoSubmission({ questId, userId, isDefault }) {
  const [submission, setSubmission] = useState(undefined); // undefined = loading, null = none yet
  const [file, setFile] = useState(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState(null);
  const [submittedPhotoUrl, setSubmittedPhotoUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [showCompletionForm, setShowCompletionForm] = useState(false);
  const [reflection, setReflection] = useState('');

  useEffect(() => {
    setSubmission(undefined);
    setFile(null);
    setError('');
    setShowCompletionForm(false);
    setReflection('');
    return onSnapshot(
      doc(db, 'photoSubmissions', `${questId}_${userId}`),
      (snap) => setSubmission(snap.exists() ? snap.data() : null),
      (err) => {
        setError(err.message || 'Could not load your photo submission.');
        setSubmission(null);
      },
    );
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
      await callSubmitQuestPhoto({ questId, storagePath, contentType: file.type, reflection: isDefault ? reflection.trim() : undefined });
      setFile(null);
      setReflection('');
      setShowCompletionForm(false);
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setUploading(false);
    }
  }

  if (submission === undefined) return <LoadingSpinner label="Loading photo status..." />;

  if (submission && (submission.status === 'pending' || submission.status === 'approved')) {
    return (
      <div className="ink-card flex flex-col gap-sm" style={{ marginTop: 12 }}>
        <p style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700 }}>Proof photo</p>
        {submittedPhotoUrl && (
          <img
            src={submittedPhotoUrl}
            alt="Your submitted proof"
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
  }

  // Side quest, never submitted before, hasn't clicked "Mark as complete"
  // yet — the reflection/photo form only appears once they do. A quest
  // that's already been rejected skips this gate (falls through to the
  // form directly below) since intent to complete it is already clear.
  if (isDefault && !submission && !showCompletionForm) {
    return (
      <div className="ink-card flex flex-col gap-sm" style={{ marginTop: 12 }}>
        <p style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700 }}>Complete this side quest</p>
        <StampButton type="button" variant="primary" onClick={() => setShowCompletionForm(true)}>
          Mark as complete
        </StampButton>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="ink-card flex flex-col gap-md" style={{ marginTop: 12 }}>
      <p style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700 }}>
        {isDefault ? 'Reflection & photo' : 'Proof photo'}
      </p>
      {submission?.status === 'rejected' && (
        <>
          {submittedPhotoUrl && (
            <img
              src={submittedPhotoUrl}
              alt="Your rejected submission"
              style={{ maxWidth: '100%', borderRadius: 'var(--radius)' }}
            />
          )}
          {submission.reflection && <p style={{ margin: 0 }}>{submission.reflection}</p>}
          <StatusStamp tone="rejected">Rejected</StatusStamp>
          {submission.rejectionReason && <p style={{ margin: 0 }}>{submission.rejectionReason}</p>}
        </>
      )}
      {isDefault && (
        <label>
          Your reflection
          <textarea
            required
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
            placeholder="What did you do, and how did it go?"
          />
        </label>
      )}
      <label>
        {submission?.status === 'rejected' ? 'Submit a new photo' : 'Upload a photo'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </label>
      {localPreviewUrl && (
        <img src={localPreviewUrl} alt="Selected photo preview" style={{ maxWidth: '100%', borderRadius: 'var(--radius)' }} />
      )}
      {error && <p className="box-danger">{error}</p>}
      <StampButton type="submit" variant="primary" disabled={!file || uploading || (isDefault && !reflection.trim())}>
        {uploading ? 'Uploading...' : isDefault ? 'Submit completion' : 'Submit photo'}
      </StampButton>
    </form>
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

  if (loading) return <LoadingSpinner label="Loading reviews..." />;
  if (error) return <p className="box-danger">{error}</p>;

  return (
    <ul className="data-sublist" style={{ marginTop: 12 }}>
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
  const [showReview, setShowReview] = useState(false);
  const [showReviewsList, setShowReviewsList] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const reduce = useReducedMotion();

  // Reset to the first occurrence and collapse any open sub-panels whenever
  // a different series is shown in this slot (desktop: clicking a new row
  // reuses this same mounted component rather than remounting it).
  useEffect(() => {
    setSelectedId(occurrences[0].id);
    setShowReview(false);
    setShowReviewsList(false);
    setShareOpen(false);
  }, [series.seriesId]);

  const selected = occurrences.find((o) => o.id === selectedId) || occurrences[0];
  const rsvpCount = (selected.rsvpd || []).length;
  const isRsvpd = (selected.rsvpd || []).includes(userId);
  const isFull = selected.capacity != null && rsvpCount >= selected.capacity && !isRsvpd;

  return (
    <div className="quest-card-body">
      {showTitle && (
        <div>
          <p className="quest-title" style={{ fontSize: '1.25rem' }}>{primary.title}</p>
          {primary.orgName && (
            <p className="quest-org-line">
              {primary.orgId ? (
                <Link to={`/organizations/${primary.orgId}`}>{primary.orgName}</Link>
              ) : (
                primary.orgName
              )}
            </p>
          )}
        </div>
      )}
      {formatRecurrence(primary) && <p className="quest-org-line">{formatRecurrence(primary)}</p>}
      {occurrences.length > 1 ? (
        <label>
          Date
          <select
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setShowReview(false);
              setShowReviewsList(false);
            }}
          >
            {occurrences.map((o) => {
              const full = o.capacity != null && (o.rsvpd || []).length >= o.capacity && !(o.rsvpd || []).includes(userId);
              return (
                <option key={o.id} value={o.id}>
                  {formatEventDate(o.eventDate)}
                  {o.capacity ? ` — ${(o.rsvpd || []).length}/${o.capacity} spots` : ''}
                  {full ? ' (Full)' : ''}
                </option>
              );
            })}
          </select>
        </label>
      ) : (
        formatEventDate(selected.eventDate) && (
          <p className="quest-meta-row">
            <IconCalendar /> {formatEventDate(selected.eventDate)}
          </p>
        )
      )}
      {selected.location && (
        <p className="quest-meta-row">
          <IconPin /> {selected.location}
        </p>
      )}
      <p className="quest-meta-row">
        <IconUsers /> {selected.capacity
          ? `${rsvpCount} / ${selected.capacity} spots filled`
          : `${rsvpCount} ${primary.isDefault ? 'accepted' : "RSVP'd"}`}
      </p>
      <p className="quest-description">{primary.description}</p>
      <div className="quest-tags">
        {primary.isDefault && <TierBadge tier={primary.tier} />}
        {(primary.tags || []).map((tag) => (
          <TagStamp key={tag} tone={tag}>
            {tag}
          </TagStamp>
        ))}
      </div>
      {/* Side quests are self-directed with no physical venue, so
          accessibility accommodations only ever apply to organization
          quests — see accommodationTags' required-field validation in
          create_quest. */}
      {!primary.isDefault && (
        <div className="ink-card" style={{ marginTop: 8 }}>
          <p style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700 }}>Accessibility</p>
          {(primary.accommodationTags || []).length > 0 ? (
            <>
              <ul className="data-sublist" style={{ marginTop: 6 }}>
                {primary.accommodationTags.map((tag) => (
                  <li key={tag}>{accommodationLabel(tag)}</li>
                ))}
              </ul>
              {primary.accommodationDetails && <p style={{ margin: '6px 0 0' }}>{primary.accommodationDetails}</p>}
            </>
          ) : (
            <p style={{ margin: '6px 0 0' }}>Accessibility information not yet provided.</p>
          )}
        </div>
      )}
      {gate && (
        <p className="side-quest-gate" id={`${selected.id}-gate`} role="status">
          <IconLock /> {gate.message}
        </p>
      )}
      <div className="quest-actions">
        {canRsvp && (
          <StampButton
            type="button"
            variant={isRsvpd ? 'danger' : 'primary'}
            onClick={() => onToggleRsvp(selected)}
            disabled={busyId === selected.id || isFull || !!gate}
            aria-describedby={gate ? `${selected.id}-gate` : undefined}
          >
            {busyId === selected.id
              ? 'Saving...'
              : gate
                ? (gate.type === 'locked' ? 'Locked' : 'Limit reached')
                : isFull
                  ? 'Full'
                  : isRsvpd
                    ? (primary.isDefault ? 'Leave quest' : 'Cancel RSVP')
                    : (primary.isDefault ? 'Accept Quest' : 'RSVP')}
          </StampButton>
        )}
        {gate && onGoToOrgQuests && (
          <StampButton type="button" variant="primary" onClick={onGoToOrgQuests}>
            View organization quests
          </StampButton>
        )}
        {!canRsvp && onGuestRsvp && (
          <StampButton type="button" variant="primary" onClick={onGuestRsvp}>
            {primary.isDefault ? 'Accept Quest' : 'RSVP'}
          </StampButton>
        )}
        <AnimatePresence>
          {canRsvp && isRsvpd && busyId !== selected.id && (
            <motion.span
              className="quest-rsvp-confirm"
              initial={reduce ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <IconCheck /> {primary.isDefault ? 'Accepted!' : "You're in!"}
            </motion.span>
          )}
        </AnimatePresence>
        {/* Reviews, sharing, and calendar exports are all organization-quest
            concepts — side quests have no organization to review, and no
            individual event worth its own shareable link or calendar entry. */}
        {!primary.isDefault && canRsvp && isRsvpd && (
          <StampButton type="button" onClick={() => setShowReview((v) => !v)}>
            {showReview ? 'Hide review' : 'Leave a review'}
          </StampButton>
        )}
        {!primary.isDefault && (
          <StampButton type="button" onClick={() => setShowReviewsList((v) => !v)}>
            {showReviewsList ? 'Hide reviews' : 'View reviews'}
          </StampButton>
        )}
        {!primary.isDefault && (
          <StampButton type="button" onClick={() => setShareOpen((v) => !v)}>
            {shareOpen ? 'Hide share link' : 'Share quest'}
          </StampButton>
        )}
        {!primary.isDefault && <AddToCalendar quest={selected} />}
      </div>
      {!primary.isDefault && isRsvpd && showReview && <QuestReview questId={selected.id} />}
      {canRsvp && isRsvpd && (
        <QuestPhotoSubmission questId={selected.id} userId={userId} isDefault={!!primary.isDefault} />
      )}
      {!primary.isDefault && showReviewsList && <QuestReviewsList questId={selected.id} />}
      {!primary.isDefault && shareOpen && <ShareQuestBox seriesId={primary.seriesId} />}
    </div>
  );
}

// One row per series (not per date) — a recurring quest with 8 scheduled
// occurrences shows as a single row with a date picker inside its detail,
// rather than flooding the list with 8 near-duplicate entries. RSVP only
// happens once expanded (QuestDetailBody) — there's no quick-accept action
// on the collapsed card.
function QuestRow({ series, isLast, isOpen, isActive, gate, onSelect, children }) {
  const { primary, occurrences } = series;

  return (
    <motion.li className="quest-row" variants={itemVariants}>
      <div className="quest-node-col">
        <div className="quest-thumb">
          <OrgAvatar name={primary.orgName} seed={primary.orgId || series.seriesId} />
        </div>
        {!isLast && <div className="quest-thread" />}
      </div>

      <div className="ink-card quest-content-col" data-active={isActive ? 'true' : undefined} data-gated={gate?.type}>
        <button type="button" className="quest-card-head" onClick={onSelect} aria-expanded={isOpen || isActive}>
          <div className="quest-card-titles">
            <p className="quest-title">{primary.title}</p>
            {primary.isDefault && primary.tier && (
              <p className="quest-org-line"><TierBadge tier={primary.tier} /></p>
            )}
            {gate && (
              <p className="quest-gate-badge">
                <IconLock /> {gate.type === 'locked' ? 'Locked' : 'Side quest limit reached'}
              </p>
            )}
            {/* Plain text, not a Link — this whole row is already inside a
                <button onClick={onSelect}> to expand the card, and an <a>
                can't nest inside a <button>. The org name IS a link once
                the card is expanded (see QuestDetailBody above). */}
            {primary.orgName && <p className="quest-org-line">{primary.orgName}</p>}
            {primary.location && (
              <p className="quest-org-line">
                <span className="quest-dot" aria-hidden="true" />
                {primary.location}
              </p>
            )}
            {series.reviewCount > 0 && (
              <p className="quest-org-line">
                {formatStars(series.avgRating)} ({series.reviewCount})
              </p>
            )}
            {occurrences.length > 1 && <p className="quest-org-line">{occurrences.length} upcoming dates</p>}
          </div>
          <IconChevron className="quest-chevron" data-open={isOpen ? 'true' : 'false'} />
        </button>
        {isOpen && children}
      </div>
    </motion.li>
  );
}

// One entrance per row, staggered from the parent's transition — cheap
// enough at feed scale (a few dozen series) and gives the list a sense of
// arriving rather than just appearing.
const listVariants = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

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
function sideQuestGate(primary, status) {
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
  const reduce = useReducedMotion();
  const isDesktop = useIsDesktop();

  function load() {
    setLoadError(null);
    Promise.all([getDocs(collection(db, 'quests')), getDocs(collection(db, 'questSeries'))])
      .then(([questsSnap, seriesSnap]) => {
        const all = questsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(isUpcoming);
        const seriesDocsById = new Map(seriesSnap.docs.map((d) => [d.id, d.data()]));
        const grouped = attachSeriesRatings(groupBySeries(all), seriesDocsById);
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
    callGetSideQuestStatus().then(setSideQuestStatus).catch(() => {});
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
    return seriesList.filter((s) => (segment === 'side-quests' ? s.primary.isDefault : !s.primary.isDefault));
  }, [seriesList, segment]);

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
    return list;
  }, [segmentedList, activeTag, search]);

  const activeSeriesId = isDesktop ? openSeriesId ?? visibleSeries[0]?.seriesId ?? null : openSeriesId;
  const activeSeries = visibleSeries.find((s) => s.seriesId === activeSeriesId) || null;

  if (loadError) {
    return (
      <div className="ink-card quest-empty quest-error">
        <IconAlert />
        <h2>Couldn't load quests</h2>
        <p>{loadError}</p>
        <StampButton type="button" variant="primary" onClick={load} style={{ marginTop: 8 }}>
          Try again
        </StampButton>
      </div>
    );
  }

  if (!seriesList) return <LoadingSpinner label="Loading quests..." />;

  if (seriesList.length === 0) {
    return (
      <div className="quest-empty">
        <DuckMark size={96} />
        <h2>No quests yet</h2>
        <p>Check back soon — organizations are just getting started.</p>
      </div>
    );
  }

  const firstName = name ? name.split(' ')[0] : null;

  return (
    <div className={isDesktop ? 'quest-feed-layout' : undefined}>
      <div className="quest-feed-main">
        <div className="quest-feed-greeting">
          <h1>{firstName ? `Hi, ${firstName}` : 'Quests near you'}</h1>
          <p>
            {seriesList.length} quest{seriesList.length === 1 ? '' : 's'} open — here's what's happening nearby.
          </p>
        </div>

        {role === 'admin' && (
          <div className="stat-hero-row">
            <div className="stat-hero-tile" style={{ background: 'var(--brand-green)' }}>
              <span className="stat-hero-number">{seriesList.length}</span>
              <span className="stat-hero-label">Quests Open</span>
            </div>
            <div className="stat-hero-tile" style={{ background: 'var(--brand-blue)' }}>
              <span className="stat-hero-number">{orgCount}</span>
              <span className="stat-hero-label">Organizations</span>
            </div>
          </div>
        )}

        <div className="segmented-toggle" role="tablist" aria-label="Quest source">
          <button
            type="button"
            role="tab"
            aria-pressed={segment === 'org'}
            onClick={() => {
              setSegment('org');
              setActiveTag(null);
            }}
          >
            org
          </button>
          <button
            type="button"
            role="tab"
            aria-pressed={segment === 'side-quests'}
            onClick={() => {
              setSegment('side-quests');
              setActiveTag(null);
            }}
          >
            side-quests
          </button>
        </div>
        <div className="search-field" style={{ maxWidth: 640, marginBottom: 14 }}>
          <IconSearch />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            aria-label="Search quests"
          />
        </div>

        {availableTags.length > 0 && (
          <div className="tag-filter-row">
            <TagStamp selectable selected={activeTag === null} onClick={() => setActiveTag(null)}>
              All
            </TagStamp>
            {availableTags.map((tag) => (
              <TagStamp key={tag} tone={tag} selectable selected={activeTag === tag} onClick={() => setActiveTag(tag)}>
                {tag}
              </TagStamp>
            ))}
          </div>
        )}

        {visibleSeries.length === 0 ? (
          <p>No quests match that filter.</p>
        ) : (
          <motion.ul className="quest-list" variants={listVariants} initial={reduce ? false : 'hidden'} animate="show">
            {visibleSeries.map((series, i) => {
              const gate = sideQuestGate(series.primary, sideQuestStatus);
              return (
                <QuestRow
                  key={series.seriesId}
                  series={series}
                  isLast={i === visibleSeries.length - 1}
                  isOpen={!isDesktop && openSeriesId === series.seriesId}
                  isActive={isDesktop && activeSeriesId === series.seriesId}
                  gate={gate}
                  onSelect={() =>
                    setOpenSeriesId(!isDesktop && openSeriesId === series.seriesId ? null : series.seriesId)
                  }
                >
                  {!isDesktop && openSeriesId === series.seriesId && (
                    <QuestDetailBody
                      series={series}
                      userId={user?.uid}
                      canRsvp={role === 'user'}
                      busyId={busyId}
                      onToggleRsvp={toggleRsvp}
                      gate={gate}
                      onGoToOrgQuests={() => setSegment('org')}
                    />
                  )}
                </QuestRow>
              );
            })}
          </motion.ul>
        )}
      </div>

      {isDesktop && (
        <div className="ink-card quest-detail-pane">
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
            <div className="quest-detail-empty">
              <DuckMark size={56} />
              <p>Select a quest to see its details.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
