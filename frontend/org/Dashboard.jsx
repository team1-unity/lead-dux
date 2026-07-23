import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { AnimatePresence, motion } from 'framer-motion';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import {
  callCreateQuest,
  callCreateRecurringQuest,
} from '@shared/fetch.jsx';
import { groupBySeries, attachSeriesRatings, formatRecurrence } from '@shared/questSeries.js';
import { useQuestSeriesActions } from '@shared/useQuestSeriesActions.js';
import { useIsDesktop } from '@shared/useIsDesktop.js';
import { ConfirmBox, ShareQuestBox, formatEventDate, formatStars } from '@shared/QuestSeriesRow.jsx';
import { QuestSeriesRow } from '@shared/QuestSeriesRow.jsx';
import { TopBar } from '@shared/TopBar.jsx';
import { AmbientParticles } from '@shared/AmbientParticles.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { TagStamp } from '@shared/TagStamp.jsx';
import { OrgAvatar } from '@shared/OrgAvatar.jsx';
import { DuckMark } from '@shared/Logo.jsx';
import { AddToCalendar } from '@shared/AddToCalendar.jsx';
import { EventDateFields, detectTimezone } from '@shared/EventDateFields.jsx';
import { PlaceAutocompleteInput } from '@shared/PlaceAutocompleteInput.jsx';
import { PendingPhotoSubmissions } from '@shared/PendingPhotoSubmissions.jsx';
import { PendingFeedbackRequests } from '@shared/PendingFeedbackRequests.jsx';
import { ACCOMMODATION_OPTIONS } from '@shared/accommodations.js';
import {
  IconPlus,
  IconSearch,
  IconFilter,
  IconEdit,
  IconChevron,
  IconCalendar,
  IconPin,
  IconUsers,
} from '@shared/icons.jsx';

// One entrance per row, staggered from the parent's transition — same
// values as mobile/Quests.jsx's own copy (not exported from there, so
// duplicated here rather than shared).
const listVariants = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

// The compact left-column row — title, review rating if any, and an
// upcoming-dates/date summary. Every quest here belongs to this same org,
// so (unlike the public feed) an org-name subtitle would be redundant;
// the avatar node stays purely for visual consistency with that feed.
function QuestSeriesListItem({ series, isLast, isOpen, isActive, onSelect, children }) {
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
            {series.reviewCount > 0 && (
              <p className="quest-org-line">
                {formatStars(series.avgRating)} ({series.reviewCount})
              </p>
            )}
            <p className="quest-org-line">
              {occurrences.length > 1
                ? `${occurrences.length} upcoming dates`
                : formatEventDate(occurrences[0].eventDate) || 'No date set'}
            </p>
          </div>
          <IconChevron className="quest-chevron" data-open={isOpen ? 'true' : 'false'} />
        </button>
        {isOpen && children}
      </div>
    </motion.li>
  );
}

// The full detail view — date picker, location/capacity, description,
// tags, and every management action (attendees/reviews/scanning/recurring/
// delete). Rendered exactly once at a time (inline under its row on
// mobile, or in the sticky side panel on desktop) via useQuestSeriesActions,
// the same hook QuestSeriesRow (the admin dashboard's dense single-row
// view) uses — one implementation, two presentations.
function QuestSeriesDetailPane({ series, onChanged, showTitle = false }) {
  const { primary, occurrences } = series;
  const a = useQuestSeriesActions(series, onChanged);
  const { selected, selectedId, isSeries } = a;
  // Per-series, not per-date (see ShareQuestBox) — no reset needed when
  // switchDate changes which occurrence is selected.
  const [shareOpen, setShareOpen] = useState(false);

  // Reset to the first occurrence and collapse any open sub-panels
  // whenever a different series is shown in this slot (desktop: clicking
  // a new row reuses this same mounted component rather than remounting).
  useEffect(() => {
    a.switchDate(occurrences[0].id);
    setShareOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.seriesId]);

  const rsvpCount = (selected.rsvpd || []).length;

  return (
    <div className="quest-card-body">
      {showTitle && (
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="quest-detail-edit-btn"
            disabled
            title="Editing an existing quest isn't available yet"
          >
            <IconEdit />
          </button>
          <p className="quest-title" style={{ fontSize: '1.4rem', paddingRight: 40 }}>
            {primary.title}
          </p>
          {primary.orgName && <p className="quest-org-line">{primary.orgName}</p>}
        </div>
      )}
      {formatRecurrence(primary) && <p className="quest-org-line">{formatRecurrence(primary)}</p>}
      {isSeries ? (
        <label>
          Date
          <select value={selectedId} onChange={(e) => a.switchDate(e.target.value)}>
            {occurrences.map((o) => (
              <option key={o.id} value={o.id}>
                {formatEventDate(o.eventDate)} — {(o.rsvpd || []).length}
                {o.capacity ? `/${o.capacity}` : ''} RSVP'd
              </option>
            ))}
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
        <StampButton type="button" variant="primary" onClick={a.toggleAttendees} disabled={a.busy}>
          {a.attendeesOpen ? 'Hide attendees' : 'Manage Attendees'}
        </StampButton>
        <StampButton type="button" onClick={a.toggleReviews} disabled={a.busy}>
          {a.reviewsOpen ? 'Hide reviews' : 'View reviews'}
        </StampButton>
        <StampButton type="button" onClick={() => setShareOpen((v) => !v)} disabled={a.busy}>
          {shareOpen ? 'Hide share link' : 'Share quest'}
        </StampButton>
        {!selected.qrToken ? (
          <StampButton type="button" onClick={a.generateQr} disabled={a.qrBusy}>
            {a.qrBusy ? 'Generating...' : 'Generate QR Code'}
          </StampButton>
        ) : (
          <>
            <StampButton type="button" onClick={a.viewQr} disabled={a.qrBusy}>
              {a.qrOpen ? 'Hide QR Code' : 'View QR Code'}
            </StampButton>
            <StampButton type="button" onClick={a.refreshQr} disabled={a.qrBusy}>
              Refresh QR Code
            </StampButton>
          </>
        )}
        {!isSeries && (
          <StampButton type="button" onClick={() => a.setRecurring((v) => !v)}>
            {a.recurring ? 'Cancel' : 'Make recurring'}
          </StampButton>
        )}
        <AddToCalendar quest={selected} />
        <StampButton
          type="button"
          variant="danger"
          onClick={() => a.setDeleteAction(a.deleteAction === 'one' ? null : 'one')}
        >
          Delete this date
        </StampButton>
        {isSeries && (
          <>
            <StampButton
              type="button"
              variant="danger"
              onClick={() => a.setDeleteAction(a.deleteAction === 'keep' ? null : 'keep')}
            >
              Keep only this date
            </StampButton>
            <StampButton
              type="button"
              variant="danger"
              onClick={() => a.setDeleteAction(a.deleteAction === 'all' ? null : 'all')}
            >
              Delete all in series
            </StampButton>
          </>
        )}
      </div>
      {a.deleteAction === 'one' && (
        <ConfirmBox
          message="Delete this one date, including its RSVPs and attendance. Any reviews already left for it stay part of this quest's review history. This cannot be undone."
          confirmLabel="Yes, delete this date"
          submitting={a.deleteSubmitting}
          onConfirm={a.deleteThisDate}
          onCancel={() => a.setDeleteAction(null)}
        />
      )}
      {a.deleteAction === 'keep' && (
        <ConfirmBox
          message={`This cancels the recurrence and deletes the other ${occurrences.length - 1} date${occurrences.length - 1 === 1 ? '' : 's'} in this series — only the selected date stays, as a standalone quest. This cannot be undone.`}
          confirmLabel="Yes, keep only this date"
          submitting={a.deleteSubmitting}
          onConfirm={a.keepOnlyThisDate}
          onCancel={() => a.setDeleteAction(null)}
        />
      )}
      {a.deleteAction === 'all' && (
        <ConfirmBox
          message={`This deletes all ${occurrences.length} dates in this series, including their RSVPs, attendance, and reviews. This cannot be undone.`}
          confirmLabel={`Yes, delete ${occurrences.length} events`}
          submitting={a.deleteSubmitting}
          onConfirm={a.deleteAllInSeries}
          onCancel={() => a.setDeleteAction(null)}
        />
      )}
      {a.recurring && (
        <form onSubmit={a.makeRecurring} className="ink-card flex flex-col gap-md" style={{ marginTop: 12 }}>
          <p style={{ margin: 0 }}>
            This date becomes the first occurrence — the remaining dates reuse its title, description, location,
            time of day, and timezone.
          </p>
          <label>
            Repeats
            <select value={a.recurFrequency} onChange={(e) => a.setRecurFrequency(e.target.value)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label>
            Until
            <input type="date" required value={a.recurUntil} onChange={(e) => a.setRecurUntil(e.target.value)} />
          </label>
          {a.recurError && <p className="box-danger">{a.recurError}</p>}
          <StampButton type="submit" variant="primary" disabled={a.recurSubmitting}>
            {a.recurSubmitting ? 'Saving...' : 'Make recurring'}
          </StampButton>
        </form>
      )}
      {a.qrError && <p className="box-danger">{a.qrError}</p>}
      {a.qrOpen && a.qr && (
        <div className="ink-card event-qr-display">
          <img src={a.qr} alt="Event check-in QR code" />
          <p className="data-stat">Attendees scan this from the app's Check In screen.</p>
        </div>
      )}
      {shareOpen && <ShareQuestBox seriesId={primary.seriesId} />}
      {a.attendeesOpen && a.attendees && (
        <ul className="data-sublist">
          {a.attendees.length === 0 && <li>No RSVPs yet.</li>}
          {a.attendees.map((att) => (
            <li key={att.uid}>
              {att.name || 'Unnamed'} — {att.email}
              {' — '}
              {att.status === 'checked_in' ? 'Checked in' : 'Not checked in'}
            </li>
          ))}
        </ul>
      )}
      {a.reviewsOpen && a.reviews && (
        <ul className="data-sublist">
          {a.reviews.length === 0 && <li>No reviews yet.</li>}
          {a.reviews.map((r) => (
            <li key={`${r.uid}-${r.eventDate}`}>
              {formatStars(r.rating)} — {r.name || 'Unnamed'}
              {r.eventDate ? ` (${formatEventDate(r.eventDate)})` : ''}: {r.body}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OrgQuests() {
  const { user } = useAuth();
  const isDesktop = useIsDesktop();
  const [quests, setQuests] = useState(null);
  const [seriesAggregates, setSeriesAggregates] = useState(new Map());
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [filterOpen, setFilterOpen] = useState(true);
  const [openSeriesId, setOpenSeriesId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventEndTime, setEventEndTime] = useState('');
  const [timezone, setTimezone] = useState(detectTimezone());
  const [location, setLocation] = useState('');
  const [placeId, setPlaceId] = useState(null);
  const [coords, setCoords] = useState(null); // { lat, lng } — see PlaceAutocompleteInput
  // Bumped after every successful submit to force a fresh
  // PlaceAutocompleteInput instance — the widget owns its own shadow-DOM
  // input, so there's no clean imperative "clear the displayed text" call;
  // remounting is the straightforward way to reset it alongside the rest
  // of the form.
  const [placeKey, setPlaceKey] = useState(0);
  const [accommodationTags, setAccommodationTags] = useState([]);
  const [accommodationDetails, setAccommodationDetails] = useState('');
  const [capacity, setCapacity] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState('weekly');
  const [until, setUntil] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const [questsSnap, seriesSnap] = await Promise.all([
      getDocs(query(collection(db, 'quests'), where('orgId', '==', user.uid))),
      getDocs(collection(db, 'questSeries')),
    ]);
    setQuests(questsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setSeriesAggregates(new Map(seriesSnap.docs.map((d) => [d.id, d.data()])));
  }

  useEffect(() => {
    load();
  }, [user]);

  const seriesList = useMemo(
    () => (quests ? attachSeriesRatings(groupBySeries(quests), seriesAggregates) : []),
    [quests, seriesAggregates],
  );

  const availableTags = useMemo(() => {
    const seen = new Set();
    seriesList.forEach((s) => (s.primary.tags || []).forEach((t) => seen.add(t)));
    return [...seen];
  }, [seriesList]);

  const visibleSeries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return seriesList.filter((s) => {
      const matchesSearch = !q || s.primary.title.toLowerCase().includes(q);
      const matchesTag = !activeTag || (s.primary.tags || []).includes(activeTag);
      return matchesSearch && matchesTag;
    });
  }, [seriesList, search, activeTag]);

  function toggleAccommodationTag(value) {
    setAccommodationTags((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  async function createQuest(e) {
    e.preventDefault();
    setError('');
    if (!placeId) {
      setError('Select a location from the suggestions.');
      return;
    }
    if (accommodationTags.length === 0) {
      setError('Select at least one accessibility accommodation for this quest.');
      return;
    }
    setSubmitting(true);
    try {
      const base = {
        title,
        description,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        eventDate,
        eventEndTime: eventEndTime || null,
        timezone,
        location,
        placeId,
        lat: coords?.lat,
        lng: coords?.lng,
        capacity: capacity ? Number(capacity) : null,
        accommodationTags,
        accommodationDetails: accommodationDetails.trim() || null,
      };
      if (isRecurring) {
        await callCreateRecurringQuest({ ...base, frequency, until });
      } else {
        await callCreateQuest(base);
      }
      setTitle('');
      setDescription('');
      setTags('');
      setEventDate('');
      setEventEndTime('');
      setLocation('');
      setPlaceId(null);
      setCoords(null);
      setPlaceKey((k) => k + 1);
      setAccommodationTags([]);
      setAccommodationDetails('');
      setCapacity('');
      setIsRecurring(false);
      setUntil('');
      setCreating(false);
      await load();
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!quests) return <LoadingSpinner label="Loading your quests..." />;

  const activeSeriesId = isDesktop ? openSeriesId ?? visibleSeries[0]?.seriesId ?? null : openSeriesId;
  const activeSeries = visibleSeries.find((s) => s.seriesId === activeSeriesId) || null;

  const createForm = (
    <form onSubmit={createQuest} className="flex flex-col gap-md">
      <label>
        Title
        <input required value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Description
        <textarea required value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        Tags (comma separated)
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      <label>
        Location
        <PlaceAutocompleteInput
          key={placeKey}
          ariaLabel="Quest location"
          placeholder="Search for an address or venue..."
          onSelect={({ location: selectedLocation, placeId: selectedPlaceId, lat, lng }) => {
            setLocation(selectedLocation);
            setPlaceId(selectedPlaceId);
            setCoords({ lat, lng });
          }}
        />
        {placeId && <p className="field-optional">{location}</p>}
      </label>
      <fieldset>
        <legend>Accessibility accommodations</legend>
        <p className="field-optional" style={{ marginTop: 0 }}>
          Select at least one so attendees know what's available before deciding to attend.
        </p>
        <div className="flex flex-wrap gap-sm" style={{ marginTop: 8 }}>
          {ACCOMMODATION_OPTIONS.map((option) => (
            <TagStamp
              key={option.value}
              selectable
              selected={accommodationTags.includes(option.value)}
              onClick={() => toggleAccommodationTag(option.value)}
            >
              {option.label}
            </TagStamp>
          ))}
        </div>
      </fieldset>
      <label>
        Additional accessibility details (optional)
        <textarea
          value={accommodationDetails}
          onChange={(e) => setAccommodationDetails(e.target.value)}
          placeholder="e.g. Ring the side door bell for wheelchair entry."
        />
      </label>
      <label>
        Capacity (optional)
        <input
          type="number"
          min="1"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          placeholder="Unlimited"
        />
      </label>
      <EventDateFields
        eventDate={eventDate}
        eventEndTime={eventEndTime}
        timezone={timezone}
        onEventDateChange={setEventDate}
        onEventEndTimeChange={setEventEndTime}
        onTimezoneChange={setTimezone}
      />
      <label className="flex items-center gap-sm">
        <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
        Recurring event
      </label>
      {isRecurring && (
        <>
          <label>
            Repeats
            <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label>
            Until
            <input type="date" required value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        </>
      )}
      {error && <p className="box-danger">{error}</p>}
      <div className="flex gap-sm">
        <StampButton type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Creating...' : isRecurring ? 'Create recurring quest' : 'Create quest'}
        </StampButton>
        <StampButton type="button" onClick={() => setCreating(false)} disabled={submitting}>
          Cancel
        </StampButton>
      </div>
    </form>
  );

  return (
    <div className={isDesktop ? 'quest-feed-layout' : undefined}>
      <div className="quest-feed-main">
        <div className="quest-feed-greeting">
          <h1>Quests near you</h1>
          <p>
            {seriesList.length} quest{seriesList.length === 1 ? '' : 's'} open — manage what's happening nearby.
          </p>
        </div>

        <div className="org-quests-toolbar">
          <div className="search-field">
            <IconSearch />
            <input
              type="search"
              placeholder="Search quests"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search your quests"
            />
          </div>
          {availableTags.length > 0 && (
            <button
              type="button"
              className="filter-icon-btn"
              aria-pressed={filterOpen}
              aria-label="Toggle tag filters"
              onClick={() => setFilterOpen((v) => !v)}
            >
              <IconFilter />
            </button>
          )}
        </div>

        {filterOpen && availableTags.length > 0 && (
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

        {/* Mobile keeps the original inline dashed toggle + form — the
            floating "+" (below) is a desktop-only affordance, anchored to
            the sticky detail pane, which doesn't exist at this width. */}
        {!isDesktop &&
          (!creating ? (
            <button type="button" className="quest-create-toggle" onClick={() => setCreating(true)}>
              <IconPlus /> Create a quest
            </button>
          ) : (
            <AnimatePresence>
              <motion.section
                className="ink-card"
                style={{ marginBottom: 16, overflow: 'hidden' }}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22 }}
              >
                <h2>Create a quest</h2>
                {createForm}
              </motion.section>
            </AnimatePresence>
          ))}

        {seriesList.length === 0 ? (
          <p>You haven't created any quests yet.</p>
        ) : visibleSeries.length === 0 ? (
          <p>No quests match your search or filter.</p>
        ) : (
          <motion.ul className="quest-list" variants={listVariants} initial="hidden" animate="show">
            {visibleSeries.map((series, i) => (
              <QuestSeriesListItem
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
                  <QuestSeriesDetailPane series={series} onChanged={load} />
                )}
              </QuestSeriesListItem>
            ))}
          </motion.ul>
        )}
      </div>

      {isDesktop && (
        <div className="ink-card quest-detail-pane">
          {creating ? (
            <div className="quest-card-body">
              <h2>Create a quest</h2>
              {createForm}
            </div>
          ) : activeSeries ? (
            <QuestSeriesDetailPane series={activeSeries} onChanged={load} showTitle />
          ) : (
            <div className="quest-detail-empty">
              <DuckMark size={56} />
              <p>Select a quest to see its details.</p>
            </div>
          )}
          <button
            type="button"
            className="quest-fab"
            onClick={() => setCreating((v) => !v)}
            aria-label={creating ? 'Close create quest form' : 'Create a quest'}
          >
            {creating ? '×' : '+'}
          </button>
        </div>
      )}
    </div>
  );
}

// About/Locations & Activities and the org's Trust Score both live on
// Profile (an org's "who we are" and standing info fits there), not here —
// this page is purely quest browsing/management.
export function Dashboard() {
  const { user } = useAuth();
  const [org, setOrg] = useState(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'organizations', user.uid)).then((snap) => {
      if (snap.exists()) setOrg(snap.data());
    });
  }, [user]);

  return (
    <PageMotion>
      <AmbientParticles />
      <TopBar title={org ? org.name : 'Organization'} hero />
      <PendingPhotoSubmissions scopeField="orgId" scopeValue={user.uid} />
      <PendingFeedbackRequests scopeField="orgId" scopeValue={user.uid} />
      <OrgQuests />
    </PageMotion>
  );
}
