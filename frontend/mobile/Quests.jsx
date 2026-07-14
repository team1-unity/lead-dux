import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { motion, useReducedMotion } from 'framer-motion';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import {
  callRsvpToQuest,
  callCancelRsvp,
  callGetQuestQr,
  callGetMyReview,
  callSubmitReview,
  callListQuestReviews,
} from '@shared/fetch.jsx';
import { groupBySeries, attachSeriesRatings, formatRecurrence } from '@shared/questSeries.js';
import { RoughTexture } from '@shared/RoughTexture.jsx';
import { RoughFrame } from '@shared/RoughFrame.jsx';
import { TagStamp } from '@shared/TagStamp.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { OrgAvatar } from '@shared/OrgAvatar.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { AddToCalendar } from '@shared/AddToCalendar.jsx';
import { IconChevron } from '@shared/icons.jsx';

const DEFAULT_EVENT_WINDOW_HOURS = 6; // mirrors functions/main.py's DEFAULT_EVENT_WINDOW_HOURS

function toDate(value) {
  return value.toDate ? value.toDate() : new Date(value);
}

// A quest is still "upcoming" until its own end window has passed — the
// same effective end used to compute QR expiry (eventEndTime, or
// eventDate + the default window when no end time was set). Past
// occurrences are hidden from the main browsing list rather than deleted,
// so RSVP history/reviews/attendance for them are still reachable by
// anyone who already has the link, just not front-and-center for browsing.
function isUpcoming(quest) {
  if (!quest.eventDate) return true;
  const end = quest.eventEndTime
    ? toDate(quest.eventEndTime)
    : new Date(toDate(quest.eventDate).getTime() + DEFAULT_EVENT_WINDOW_HOURS * 60 * 60 * 1000);
  return end.getTime() >= Date.now();
}

function formatEventDate(isoOrTimestamp) {
  if (!isoOrTimestamp) return null;
  const date = isoOrTimestamp.toDate ? isoOrTimestamp.toDate() : new Date(isoOrTimestamp);
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// The member's own check-in QR code for a quest they've RSVP'd to. Fetched
// lazily (only once the card is expanded and this is rendered) rather than
// alongside the quest list itself, since most quests in the list aren't
// ones this member RSVP'd to.
function QuestQrCode({ questId }) {
  const [state, setState] = useState({ loading: true, qr: null, expired: false, error: null });

  useEffect(() => {
    let cancelled = false;
    callGetQuestQr(questId)
      .then((data) => {
        if (!cancelled) setState({ loading: false, qr: data.qr, expired: data.expired, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, qr: null, expired: false, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [questId]);

  if (state.loading) return <LoadingSpinner label="Loading your check-in code..." />;
  if (state.error) return <p className="box-danger">{state.error}</p>;

  return (
    <div className="quest-qr" style={{ textAlign: 'center', marginTop: 12 }}>
      <img src={state.qr} alt="Your check-in QR code" style={{ maxWidth: 220, width: '100%' }} />
      {state.expired && <p className="box-warning">This code has expired.</p>}
    </div>
  );
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
        <p style={{ margin: 0, fontWeight: 700 }}>Your review: {formatStars(review.rating)}</p>
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

// Every reviewer's rating/body for this quest's series — same list an org
// or admin sees on their own dashboard (list_quest_reviews has no
// ownership gate; reviews are meant to help anyone deciding whether to
// attend), fetched lazily since most cards on the list never get expanded.
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


// One-off decorative illustration for the empty state — a hand-drawn target,
// resolved to real theme colors at draw time since <canvas> can't read CSS
// custom properties the way SVG's currentColor can.
function drawEmptyIllustration(rc, w, h) {
  const styles = getComputedStyle(document.documentElement);
  const ink = styles.getPropertyValue('--line').trim();
  const fill = styles.getPropertyValue('--tag-outdoors').trim();
  const cx = w / 2;
  const cy = h / 2;
  const outer = Math.min(w, h) - 24;
  const base = { roughness: 0.85, bowing: 0.7, stroke: ink, strokeWidth: 2.4 };
  rc.circle(cx, cy, outer, { ...base, fill, fillStyle: 'solid', seed: 11 });
  rc.circle(cx, cy, outer * 0.55, { ...base, strokeWidth: 1.8, fill: 'none', seed: 12 });
}

// One card per series (not per date) — a recurring quest with 8 scheduled
// occurrences shows as a single card with a date picker, rather than
// flooding the list with 8 near-duplicate entries. RSVP, QR check-in, and
// review all act on whichever occurrence is currently selected, since
// those are inherently per-date (see functions/main.py — nothing about
// that changed, only how many dates are visually surfaced at once).
function QuestCard({ series, userId, canRsvp, busyId, onToggleRsvp, isLast }) {
  const [open, setOpen] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showReviewsList, setShowReviewsList] = useState(false);
  const [selectedId, setSelectedId] = useState(series.occurrences[0].id);

  const selected = series.occurrences.find((o) => o.id === selectedId) || series.occurrences[0];
  const { primary, occurrences } = series;
  const rsvpCount = (selected.rsvpd || []).length;
  const isRsvpd = (selected.rsvpd || []).includes(userId);
  const isFull = selected.capacity != null && rsvpCount >= selected.capacity && !isRsvpd;

  return (
    <motion.li className="quest-row" variants={itemVariants}>
      <div className="quest-node-col">
        <div className="quest-thumb">
          <OrgAvatar name={primary.orgName} seed={primary.orgId || series.seriesId} />
        </div>
        {!isLast && (
          <div className="quest-thread">
            <RoughTexture variant="thread" seed={series.seriesId} />
          </div>
        )}
      </div>

      <div className="ink-card quest-content-col">
        <button type="button" className="quest-card-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <div className="quest-card-titles">
            <p className="quest-title">{primary.title}</p>
            {primary.orgName && <p className="quest-org-line">{primary.orgName}</p>}
            {series.reviewCount > 0 && (
              <p className="quest-org-line">
                {formatStars(series.avgRating)} ({series.reviewCount})
              </p>
            )}
          </div>
          <IconChevron className="quest-chevron" data-open={open ? 'true' : 'false'} />
        </button>

        {open && (
          <div className="quest-card-body">
            {formatRecurrence(primary) && <p className="quest-org-line">{formatRecurrence(primary)}</p>}
            {occurrences.length > 1 ? (
              <label>
                Date
                <select
                  value={selectedId}
                  onChange={(e) => {
                    setSelectedId(e.target.value);
                    setShowQr(false);
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
              formatEventDate(selected.eventDate) && <p className="quest-org-line">{formatEventDate(selected.eventDate)}</p>
            )}
            {selected.location && <p className="quest-org-line">{selected.location}</p>}
            <p className="quest-org-line">
              {selected.capacity ? `${rsvpCount} / ${selected.capacity} spots filled` : `${rsvpCount} RSVP'd`}
            </p>
            <p>{primary.description}</p>
            <div className="quest-tags">
              {(primary.tags || []).map((tag) => (
                <TagStamp key={tag} tone={tag}>
                  {tag}
                </TagStamp>
              ))}
            </div>
            <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
              {canRsvp && (
                <StampButton
                  type="button"
                  variant={isRsvpd ? 'danger' : 'primary'}
                  onClick={() => {
                    setShowQr(false);
                    onToggleRsvp(selected);
                  }}
                  disabled={busyId === selected.id || isFull}
                >
                  {busyId === selected.id ? 'Saving...' : isFull ? 'Full' : isRsvpd ? 'Cancel RSVP' : 'RSVP'}
                </StampButton>
              )}
              {canRsvp && isRsvpd && (
                <StampButton type="button" onClick={() => setShowQr((v) => !v)}>
                  {showQr ? 'Hide my check-in code' : 'Show my check-in code'}
                </StampButton>
              )}
              {canRsvp && isRsvpd && (
                <StampButton type="button" onClick={() => setShowReview((v) => !v)}>
                  {showReview ? 'Hide review' : 'Leave a review'}
                </StampButton>
              )}
              <StampButton type="button" onClick={() => setShowReviewsList((v) => !v)}>
                {showReviewsList ? 'Hide reviews' : 'View reviews'}
              </StampButton>
              <AddToCalendar quest={selected} />
            </div>
            {isRsvpd && showQr && <QuestQrCode questId={selected.id} />}
            {isRsvpd && showReview && <QuestReview questId={selected.id} />}
            {showReviewsList && <QuestReviewsList questId={selected.id} />}
          </div>
        )}
      </div>
    </motion.li>
  );
}

export function Quests({ interests }) {
  const { user, role } = useAuth();
  const [seriesList, setSeriesList] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [activeTag, setActiveTag] = useState(null);
  const reduce = useReducedMotion();

  function load() {
    Promise.all([getDocs(collection(db, 'quests')), getDocs(collection(db, 'questSeries'))]).then(
      ([questsSnap, seriesSnap]) => {
        const all = questsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(isUpcoming);
        const seriesDocsById = new Map(seriesSnap.docs.map((d) => [d.id, d.data()]));
        const grouped = attachSeriesRatings(groupBySeries(all), seriesDocsById);
        grouped.sort((a, b) => relevanceScore(b.primary, interests) - relevanceScore(a.primary, interests));
        setSeriesList(grouped);
      },
    );
  }

  useEffect(load, [interests]);

  async function toggleRsvp(quest) {
    setBusyId(quest.id);
    try {
      if ((quest.rsvpd || []).includes(user.uid)) {
        await callCancelRsvp(quest.id);
      } else {
        await callRsvpToQuest(quest.id);
      }
      load();
    } finally {
      setBusyId(null);
    }
  }

  const availableTags = useMemo(() => {
    if (!seriesList) return [];
    const seen = new Set();
    seriesList.forEach((s) => (s.primary.tags || []).forEach((t) => seen.add(t)));
    return [...seen];
  }, [seriesList]);

  const orgCount = useMemo(() => {
    if (!seriesList) return 0;
    return new Set(seriesList.filter((s) => s.primary.orgId).map((s) => s.primary.orgId)).size;
  }, [seriesList]);

  const visibleSeries = useMemo(() => {
    if (!seriesList) return [];
    if (!activeTag) return seriesList;
    return seriesList.filter((s) => (s.primary.tags || []).includes(activeTag));
  }, [seriesList, activeTag]);

  if (!seriesList) return <LoadingSpinner label="Loading quests..." />;

  if (seriesList.length === 0) {
    return (
      <div className="quest-empty">
        <RoughFrame width={120} height={120} draw={drawEmptyIllustration} />
        <h2>No Quests Yet</h2>
        <p>Check back soon — organizations are just getting started.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="stat-hero-row">
        <div className="stat-hero-tile" style={{ background: 'var(--tag-community)' }}>
          <span className="stat-hero-number">{seriesList.length}</span>
          <span className="stat-hero-label">Quests Open</span>
        </div>
        <div className="stat-hero-tile" style={{ background: 'var(--tag-education)' }}>
          <span className="stat-hero-number">{orgCount}</span>
          <span className="stat-hero-label">Organizations</span>
        </div>
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
        <motion.ul
          className="quest-list"
          variants={listVariants}
          initial={reduce ? false : 'hidden'}
          animate="show"
        >
          {visibleSeries.map((series, i) => (
            <QuestCard
              key={series.seriesId}
              series={series}
              userId={user?.uid}
              canRsvp={role === 'user'}
              busyId={busyId}
              onToggleRsvp={toggleRsvp}
              isLast={i === visibleSeries.length - 1}
            />
          ))}
        </motion.ul>
      )}
    </div>
  );
}
