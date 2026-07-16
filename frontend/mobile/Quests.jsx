import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import {
  callRsvpToQuest,
  callCancelRsvp,
  callGetMyReview,
  callSubmitReview,
  callListQuestReviews,
} from '@shared/fetch.jsx';
import { groupBySeries, attachSeriesRatings, formatRecurrence } from '@shared/questSeries.js';
import { DuckMark } from '@shared/Logo.jsx';
import { useIsDesktop } from '@shared/useIsDesktop.js';
import { TagStamp } from '@shared/TagStamp.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { OrgAvatar } from '@shared/OrgAvatar.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { AddToCalendar } from '@shared/AddToCalendar.jsx';
import { IconChevron, IconCalendar, IconPin, IconUsers, IconCheck, IconAlert, IconSearch } from '@shared/icons.jsx';

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
// own lazily-fetched sub-state (QR, review) never double-fetches.
function QuestDetailBody({ series, userId, canRsvp, busyId, onToggleRsvp, showTitle = false }) {
  const { primary, occurrences } = series;
  const [selectedId, setSelectedId] = useState(occurrences[0].id);
  const [showReview, setShowReview] = useState(false);
  const [showReviewsList, setShowReviewsList] = useState(false);
  const reduce = useReducedMotion();

  // Reset to the first occurrence and collapse any open sub-panels whenever
  // a different series is shown in this slot (desktop: clicking a new row
  // reuses this same mounted component rather than remounting it).
  useEffect(() => {
    setSelectedId(occurrences[0].id);
    setShowReview(false);
    setShowReviewsList(false);
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
          {primary.orgName && <p className="quest-org-line">{primary.orgName}</p>}
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
        <IconUsers /> {selected.capacity ? `${rsvpCount} / ${selected.capacity} spots filled` : `${rsvpCount} RSVP'd`}
      </p>
      <p className="quest-description">{primary.description}</p>
      <div className="quest-tags">
        {(primary.tags || []).map((tag) => (
          <TagStamp key={tag} tone={tag}>
            {tag}
          </TagStamp>
        ))}
      </div>
      <div className="quest-actions">
        {canRsvp && (
          <StampButton
            type="button"
            variant={isRsvpd ? 'danger' : 'primary'}
            onClick={() => onToggleRsvp(selected)}
            disabled={busyId === selected.id || isFull}
          >
            {busyId === selected.id ? 'Saving...' : isFull ? 'Full' : isRsvpd ? 'Cancel RSVP' : 'RSVP'}
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
              <IconCheck /> You're in!
            </motion.span>
          )}
        </AnimatePresence>
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
      {isRsvpd && showReview && <QuestReview questId={selected.id} />}
      {showReviewsList && <QuestReviewsList questId={selected.id} />}
    </div>
  );
}

// One row per series (not per date) — a recurring quest with 8 scheduled
// occurrences shows as a single row with a date picker inside its detail,
// rather than flooding the list with 8 near-duplicate entries. RSVP only
// happens once expanded (QuestDetailBody) — there's no quick-accept action
// on the collapsed card.
function QuestRow({ series, isLast, isOpen, isActive, onSelect, children }) {
  const { primary, occurrences } = series;

  return (
    <motion.li className="quest-row" variants={itemVariants}>
      <div className="quest-node-col">
        <div className="quest-thumb">
          <OrgAvatar name={primary.orgName} seed={primary.orgId || series.seriesId} />
        </div>
        {!isLast && <div className="quest-thread" />}
      </div>

      <div className="ink-card quest-content-col" data-active={isActive ? 'true' : undefined}>
        <button type="button" className="quest-card-head" onClick={onSelect} aria-expanded={isOpen || isActive}>
          <div className="quest-card-titles">
            <p className="quest-title">{primary.title}</p>
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

export function Quests({ interests, name }) {
  const { user, role } = useAuth();
  const [seriesList, setSeriesList] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [activeTag, setActiveTag] = useState(null);
  const [openSeriesId, setOpenSeriesId] = useState(null);
  const [segment, setSegment] = useState('org');
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
        grouped.sort((a, b) => relevanceScore(b.primary, interests) - relevanceScore(a.primary, interests));
        setSeriesList(grouped);
      })
      .catch((err) => {
        setLoadError(err.message || 'Could not load quests.');
      });
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
            {visibleSeries.map((series, i) => (
              <QuestRow
                key={series.seriesId}
                series={series}
                isLast={i === visibleSeries.length - 1}
                isOpen={!isDesktop && openSeriesId === series.seriesId}
                isActive={isDesktop && activeSeriesId === series.seriesId}
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
                  />
                )}
              </QuestRow>
            ))}
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
