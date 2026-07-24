import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { AnimatePresence, motion } from 'framer-motion';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { callCreateQuest, callCreateRecurringQuest } from '@shared/fetch.jsx';
import { groupBySeries, attachSeriesRatings, formatRecurrence } from '@shared/questSeries.js';
import { useQuestSeriesActions } from '@shared/useQuestSeriesActions.js';
import { useIsDesktop } from '@shared/useIsDesktop.js';
import {
  ConfirmBox,
  ShareButton,
  formatEventDate,
  formatStars,
} from '@shared/QuestSeriesRow.jsx';
import { TopBar } from '@shared/TopBar.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { TagStamp } from '@shared/TagStamp.jsx';
import { DuckMark } from '@shared/Logo.jsx';
import { AddToCalendar } from '@shared/AddToCalendar.jsx';
import { EventDateFields, detectTimezone } from '@shared/EventDateFields.jsx';
import { PlaceAutocompleteInput } from '@shared/PlaceAutocompleteInput.jsx';
import { ACCOMMODATION_OPTIONS } from '@shared/accommodations.js';
import {
  IconPlus,
  IconEdit,
  IconTrash,
  IconChevron,
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

// The compact collapsed row — title + description only (same flat,
// avatar-free card style as the redesigned member-facing mobile/Quests.jsx,
// minus the org avatar since every quest here already belongs to this same
// org — no profile to link out to from its own list). Unlike that member
// view, this one still expands in place rather than navigating away —
// management actions live in the detail body, not a separate page — so the
// chevron (rather than a tap hint) is still the right affordance here.
function QuestSeriesListItem({ series, isOpen, isActive, onSelect, children }) {
  const { primary } = series;
  return (
    <motion.li className='quest-row' variants={itemVariants}>
      <div className='ink-card quest-content-col' data-active={isActive ? 'true' : undefined}>
        <button
          type='button'
          className='quest-card-head'
          onClick={onSelect}
          aria-expanded={isOpen || isActive}
        >
          <div className='quest-card-titles'>
            <p className='quest-title'>{primary.title}</p>
            {primary.description && <p className='quest-card-description'>{primary.description}</p>}
          </div>
          <IconChevron className='quest-chevron' data-open={isOpen ? 'true' : 'false'} />
        </button>
        {isOpen && children}
      </div>
    </motion.li>
  );
}

// The full detail view — date picker, location/capacity, description, and
// every management action (share/delete/QR/calendar, expandable attendees/
// reviews). Rendered exactly once at a time (inline under its row on
// mobile, or in the sticky side panel on desktop) via useQuestSeriesActions,
// the same hook QuestSeriesRow (the admin dashboard's dense single-row
// view) uses — one implementation, two presentations. No tags shown here
// (browsing-time tags/search/filter were dropped from this page entirely —
// see OrgQuests below) and no "Make recurring" action (this pass's action
// set is intentionally just what's listed above).
function QuestSeriesDetailPane({ series, onChanged, showTitle = false }) {
  const { primary, occurrences } = series;
  const a = useQuestSeriesActions(series, onChanged);
  const { selected, selectedId, isSeries } = a;
  // A single Delete action for a one-off quest just deletes it — no menu
  // needed. A recurring series has 3 distinct deletion scopes, so Delete
  // becomes a small dropdown revealing them instead of 3 permanent danger
  // buttons cluttering the row.
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  // Regenerating a QR code is quiet but consequential (it kills whatever's
  // currently posted/printed/on screen) — gated behind a confirm rather
  // than firing on a single click, same treatment as the delete actions.
  const [confirmingRefresh, setConfirmingRefresh] = useState(false);

  // Reset to the first occurrence and collapse any open sub-panels
  // whenever a different series is shown in this slot (desktop: clicking
  // a new row reuses this same mounted component rather than remounting).
  useEffect(() => {
    a.switchDate(occurrences[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.seriesId]);

  // The QR panel itself closes on a date switch (see switchDate, inside
  // useQuestSeriesActions) — this just keeps the confirm step from
  // reappearing pre-opened the next time it's shown.
  useEffect(() => {
    if (!a.qrOpen) setConfirmingRefresh(false);
  }, [a.qrOpen]);

  const rsvpCount = (selected.rsvpd || []).length;

  return (
    <div className='quest-card-body'>
      {/* This icon row (not just the title below it) has to render
          regardless of showTitle — mobile passes showTitle=false (its
          collapsed card already shows the title, see QuestSeriesListItem),
          but still needs Share/Edit/Delete, so only the duplicate title
          text is actually gated on showTitle. */}
      <div style={{ position: 'relative', minHeight: 36 }}>
        <div className='quest-detail-icon-actions'>
          <ShareButton seriesId={primary.seriesId} iconOnly disabled={a.busy} />
          <button
            type='button'
            className='quest-icon-btn'
            disabled
            title="Editing an existing quest isn't available yet"
          >
            <IconEdit />
          </button>
          {!isSeries ? (
            <button
              type='button'
              className='quest-icon-btn quest-icon-btn-danger'
              onClick={() => a.setDeleteAction(a.deleteAction === 'one' ? null : 'one')}
              aria-label='Delete quest'
              title='Delete'
            >
              <IconTrash />
            </button>
          ) : (
            <div className='delete-dropdown-wrap'>
              <button
                type='button'
                className='quest-icon-btn quest-icon-btn-danger'
                onClick={() => setDeleteMenuOpen((v) => !v)}
                aria-label='Delete quest'
                title='Delete'
              >
                <IconTrash />
              </button>
              {deleteMenuOpen && (
                <div className='delete-dropdown-menu' role='menu'>
                  <button
                    type='button'
                    onClick={() => {
                      a.setDeleteAction(a.deleteAction === 'one' ? null : 'one');
                      setDeleteMenuOpen(false);
                    }}
                  >
                    Delete this date
                  </button>
                  <button
                    type='button'
                    onClick={() => {
                      a.setDeleteAction(a.deleteAction === 'keep' ? null : 'keep');
                      setDeleteMenuOpen(false);
                    }}
                  >
                    Keep only this date
                  </button>
                  <button
                    type='button'
                    onClick={() => {
                      a.setDeleteAction(a.deleteAction === 'all' ? null : 'all');
                      setDeleteMenuOpen(false);
                    }}
                  >
                    Delete all in series
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {showTitle && (
          <>
            <p className='quest-title' style={{ fontSize: '1.4rem', paddingRight: 130 }}>
              {primary.title}
            </p>
            {primary.orgName && <p className='quest-org-line'>{primary.orgName}</p>}
          </>
        )}
      </div>
      {formatRecurrence(primary) && <p className='quest-org-line'>{formatRecurrence(primary)}</p>}
      <div className='flex items-center gap-sm' style={{ flexWrap: 'wrap' }}>
        {isSeries ? (
          <label style={{ flex: '1 1 220px' }}>
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
            <p className='quest-meta-row' style={{ margin: 0 }}>
              {formatEventDate(selected.eventDate)}
            </p>
          )
        )}
        {/* The calendar icon is itself the "add to calendar" trigger — see
            AddToCalendar's iconOnly mode — rather than a separate static
            icon plus a duplicate button elsewhere on the card. */}
        <AddToCalendar quest={selected} iconOnly />
      </div>
      {selected.location && (
        <Link to={`/map?seriesId=${primary.seriesId}`} className='quest-meta-row quest-meta-link'>
          <IconPin /> {selected.location}
        </Link>
      )}
      <button
        type='button'
        className='quest-meta-row quest-meta-link'
        onClick={a.toggleAttendees}
        disabled={a.busy}
      >
        <IconUsers />{' '}
        {selected.capacity
          ? `${rsvpCount} / ${selected.capacity} spots filled`
          : `${rsvpCount} RSVP'd`}
      </button>
      <p className='quest-description'>{primary.description}</p>

      {a.deleteAction === 'one' && (
        <ConfirmBox
          message="Delete this one date, including its RSVPs and attendance. Any reviews already left for it stay part of this quest's review history. This cannot be undone."
          confirmLabel='Yes, delete this date'
          submitting={a.deleteSubmitting}
          onConfirm={a.deleteThisDate}
          onCancel={() => a.setDeleteAction(null)}
        />
      )}
      {a.deleteAction === 'keep' && (
        <ConfirmBox
          message={`This cancels the recurrence and deletes the other ${occurrences.length - 1} date${occurrences.length - 1 === 1 ? '' : 's'} in this series — only the selected date stays, as a standalone quest. This cannot be undone.`}
          confirmLabel='Yes, keep only this date'
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
      <div className='quest-actions' style={{ marginTop: 10 }}>
        {/* Every quest created from now on already has a qrToken minted at
            creation time (see _quest_doc_fields) — "Generate" only ever
            shows for quests that predate that change. */}
        {!selected.qrToken ? (
          <StampButton type='button' onClick={a.generateQr} disabled={a.qrBusy}>
            {a.qrBusy ? 'Generating...' : 'Generate QR Code'}
          </StampButton>
        ) : (
          <StampButton type='button' onClick={a.viewQr} disabled={a.qrBusy}>
            {a.qrOpen ? 'Hide QR Code' : 'View QR Code'}
          </StampButton>
        )}
      </div>
      {a.qrError && <p className='box-danger'>{a.qrError}</p>}
      {a.qrOpen && a.qr && (
        <div className='ink-card event-qr-display'>
          <img src={a.qr} alt='Event check-in QR code' />
          <p className='data-stat'>Attendees scan this from the app's Check In screen.</p>
          <div className='flex gap-sm' style={{ marginTop: 10, justifyContent: 'center' }}>
            <StampButton as='a' href={a.qr} download={`quest-${selected.id}-qr.png`}>
              Download
            </StampButton>
            <StampButton type='button' onClick={() => setConfirmingRefresh((v) => !v)} disabled={a.qrBusy}>
              Regenerate
            </StampButton>
          </div>
          {confirmingRefresh && (
            <ConfirmBox
              message="This invalidates the current code — anyone with the old one (printed, screenshotted, still on a poster) won't be able to check in with it anymore."
              confirmLabel={a.qrBusy ? 'Working...' : 'Yes, regenerate'}
              submitting={a.qrBusy}
              onConfirm={() => {
                a.refreshQr();
                setConfirmingRefresh(false);
              }}
              onCancel={() => setConfirmingRefresh(false)}
            />
          )}
        </div>
      )}

      <div className='quest-expand-section'>
        <button
          type='button'
          className='quest-card-head'
          style={{ padding: '10px 0' }}
          onClick={a.toggleAttendees}
          disabled={a.busy}
          aria-expanded={a.attendeesOpen}
        >
          <span className='quest-card-titles'>View Attendees</span>
          <IconChevron className='quest-chevron' data-open={a.attendeesOpen ? 'true' : 'false'} />
        </button>
        {a.attendeesOpen && a.attendees && (
          <ul className='data-sublist'>
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
      </div>

      <div className='quest-expand-section'>
        <button
          type='button'
          className='quest-card-head'
          style={{ padding: '10px 0' }}
          onClick={a.toggleReviews}
          disabled={a.busy}
          aria-expanded={a.reviewsOpen}
        >
          <span className='quest-card-titles'>View Reviews</span>
          <IconChevron className='quest-chevron' data-open={a.reviewsOpen ? 'true' : 'false'} />
        </button>
        {a.reviewsOpen && a.reviews && (
          <ul className='data-sublist'>
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
    </div>
  );
}

function OrgQuests() {
  const { user } = useAuth();
  const isDesktop = useIsDesktop();
  const [quests, setQuests] = useState(null);
  const [seriesAggregates, setSeriesAggregates] = useState(new Map());
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

  function toggleAccommodationTag(value) {
    setAccommodationTags((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
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
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
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

  if (!quests) return <LoadingSpinner label='Loading your quests...' />;

  const activeSeriesId = isDesktop
    ? (openSeriesId ?? seriesList[0]?.seriesId ?? null)
    : openSeriesId;
  const activeSeries = seriesList.find((s) => s.seriesId === activeSeriesId) || null;

  const createForm = (
    <form onSubmit={createQuest} className='flex flex-col gap-md'>
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
          ariaLabel='Quest location'
          placeholder='Search for an address or venue...'
          onSelect={({ location: selectedLocation, placeId: selectedPlaceId, lat, lng }) => {
            setLocation(selectedLocation);
            setPlaceId(selectedPlaceId);
            setCoords({ lat, lng });
          }}
        />
        {placeId && <p className='field-optional'>{location}</p>}
      </label>
      <fieldset>
        <legend>Accessibility accommodations</legend>
        <p className='field-optional' style={{ marginTop: 0 }}>
          Select at least one so attendees know what's available before deciding to attend.
        </p>
        <div className='flex flex-wrap gap-sm' style={{ marginTop: 8 }}>
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
          placeholder='e.g. Ring the side door bell for wheelchair entry.'
        />
      </label>
      <label>
        Capacity (optional)
        <input
          type='number'
          min='1'
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          placeholder='Unlimited'
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
      <label className='flex items-center gap-sm'>
        <input
          type='checkbox'
          checked={isRecurring}
          onChange={(e) => setIsRecurring(e.target.checked)}
        />
        Recurring event
      </label>
      {isRecurring && (
        <>
          <label>
            Repeats
            <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              <option value='daily'>Daily</option>
              <option value='weekly'>Weekly</option>
              <option value='monthly'>Monthly</option>
            </select>
          </label>
          <label>
            Until
            <input type='date' required value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        </>
      )}
      {error && <p className='box-danger'>{error}</p>}
      <div className='flex gap-sm'>
        <StampButton type='submit' variant='primary' disabled={submitting}>
          {submitting ? 'Creating...' : isRecurring ? 'Create recurring quest' : 'Create quest'}
        </StampButton>
        <StampButton type='button' onClick={() => setCreating(false)} disabled={submitting}>
          Cancel
        </StampButton>
      </div>
    </form>
  );

  return (
    <div className={isDesktop ? 'quest-feed-layout' : undefined}>
      <div className='quest-feed-main'>
        <div className='quest-feed-greeting'>
          <h1>Your Quests</h1>
          {/* <p>
            {seriesList.length} quest{seriesList.length === 1 ? '' : 's'} open — manage what's happening nearby.
          </p> */}
        </div>

        <StampButton
          type='button'
          variant='primary'
          onClick={() => setCreating((v) => !v)}
          style={{ marginBottom: 16 }}
        >
          <IconPlus /> {creating ? 'Cancel' : 'Create new quest'}
        </StampButton>

        {/* Mobile shows the form inline, right below the button above —
            desktop shows it in the sticky detail pane instead (below), which
            doesn't exist at this width. */}
        {!isDesktop && creating && (
          <AnimatePresence>
            <motion.section
              className='ink-card'
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
        )}

        {seriesList.length === 0 ? (
          <p>You haven't created any quests yet.</p>
        ) : (
          <motion.ul className='quest-list' variants={listVariants} initial='hidden' animate='show'>
            {seriesList.map((series) => (
              <QuestSeriesListItem
                key={series.seriesId}
                series={series}
                isOpen={!isDesktop && openSeriesId === series.seriesId}
                isActive={isDesktop && activeSeriesId === series.seriesId}
                onSelect={() =>
                  setOpenSeriesId(
                    !isDesktop && openSeriesId === series.seriesId ? null : series.seriesId,
                  )
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
        <div className='ink-card quest-detail-pane'>
          {creating ? (
            <div className='quest-card-body'>
              <h2>Create a quest</h2>
              {createForm}
            </div>
          ) : activeSeries ? (
            <QuestSeriesDetailPane series={activeSeries} onChanged={load} showTitle />
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

// Quest browsing/management/creation only — About/Locations & Activities,
// the org's Trust Score, and at-a-glance counts all live on org/Home.jsx
// and the org's own profile page instead (see App.jsx's routing and
// OrganizationProfile.jsx's owner edit mode).
export function Quests() {
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
      <TopBar title={org ? org.name : 'Organization'} hero />
      <OrgQuests />
    </PageMotion>
  );
}
