import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { getCachedCollection } from '@shared/collectionCache.js';
import { groupBySeries, attachSeriesRatings, isUpcoming, toDate } from '@shared/questSeries.js';
import { useQuestSeriesActions } from '@shared/useQuestSeriesActions.js';
import { useIsDesktop } from '@shared/useIsDesktop.js';
import { ConfirmBox, ShareButton, formatEventDate, formatStars } from '@shared/QuestSeriesRow.jsx';
import { TopBar } from '@shared/TopBar.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { LightboxBackdrop } from '@shared/LightboxBackdrop.jsx';
import { VanishSearchInput } from '@shared/VanishSearchInput.jsx';
import { Collapse } from '@shared/Collapse.jsx';
import { QuestReviewsList } from '@shared/QuestReviewsList.jsx';
import { OrgAvatar } from '@shared/OrgAvatar.jsx';
import { StatusStamp } from '@shared/StatusStamp.jsx';
import { DuckMark } from '@shared/Logo.jsx';
import { AddToCalendar } from '@shared/AddToCalendar.jsx';
import { LocationLink } from '@shared/LocationLink.jsx';
import { CreateQuestForm } from './CreateQuestForm.jsx';
import {
  IconPlus,
  IconEdit,
  IconTrash,
  IconChevron,
  IconUsers,
} from '@shared/icons.jsx';

// The compact collapsed row — title, star rating, and date (same flat,
// avatar-free card style as the redesigned member-facing mobile/Quests.jsx,
// minus the org avatar since every quest here already belongs to this same
// org — no profile to link out to from its own list). Unlike that member
// view, this one still expands in place rather than navigating away —
// management actions live in the detail body, not a separate page — so the
// chevron (rather than a tap hint) is still the right affordance here.
function QuestSeriesListItem({ series, index, isOpen, isActive, onSelect, children }) {
  const { primary } = series;
  const eventDate = formatEventDate(primary.eventDate);
  const reduce = useReducedMotion();
  // Dimmed rather than hidden or removed — same treatment sideQuestGate's
  // own gated rows get (see .quest-content-col[data-gated] in style.css):
  // still fully clickable/expandable so reviews/attendance for a finished
  // series stay reachable, just visually pushed behind what's still active.
  const isPast = !nextOccurrence(series);
  return (
    <motion.li
      className='quest-row'
      initial={reduce ? false : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1], delay: Math.min(index, 5) * 0.04 }}
    >
      <div
        className='ink-card quest-content-col'
        data-active={isActive ? 'true' : undefined}
        data-past={isPast ? 'true' : undefined}
      >

        <button
          type='button'
          className='quest-card-head'
          onClick={onSelect}
          aria-expanded={isOpen || isActive}
        >
          <div className='quest-card-titles'>
            <p className='quest-title'>{primary.title}</p>
            {series.reviewCount > 0 && (
              <p className='quest-card-description'>
                {formatStars(series.avgRating)} ({series.reviewCount})
              </p>
            )}
            {eventDate && <p className='quest-card-description'>{eventDate}</p>}
          </div>
          <IconChevron className='quest-chevron' data-open={isOpen ? 'true' : 'false'} />
        </button>
        <Collapse open={isOpen}>{children}</Collapse>
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
  // Replaces this whole detail body with CreateQuestForm in edit mode
  // (same component the "Add a quest" flow uses, via its editingQuest
  // prop) rather than a separate form — one document-style quest editor,
  // not two slightly different ones to keep in sync.
  const [editing, setEditing] = useState(false);

  // Reset to the first occurrence and collapse any open sub-panels
  // whenever a different series is shown in this slot (desktop: clicking
  // a new row reuses this same mounted component rather than remounting).
  useEffect(() => {
    a.switchDate(occurrences[0].id);
    setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.seriesId]);

  // The QR panel itself closes on a date switch (see switchDate, inside
  // useQuestSeriesActions) — this just keeps the confirm step from
  // reappearing pre-opened the next time it's shown.
  useEffect(() => {
    if (!a.qrOpen) setConfirmingRefresh(false);
  }, [a.qrOpen]);

  const rsvpCount = (selected.rsvpd || []).length;

  if (editing) {
    return (
      <CreateQuestForm
        quests={[]}
        editingQuest={selected}
        canMakeRecurring={!isSeries}
        seriesCoverPhotos={series.coverPhotos}
        onCreated={() => {
          setEditing(false);
          onChanged();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className='quest-card-body'>
      {/* This icon row (not just the title below it) has to render
          regardless of showTitle — mobile passes showTitle=false (its
          collapsed card already shows the title, see QuestSeriesListItem),
          but still needs Share/Edit/Delete, so only the duplicate title
          text is actually gated on showTitle. */}
      <div style={{ position: 'relative', minHeight: 36 }}>
        <div className='quest-detail-icon-actions'>
          <ShareButton seriesId={primary.seriesId} questTitle={primary.title} iconOnly disabled={a.busy} />
          <button
            type='button'
            className='quest-icon-btn'
            onClick={() => setEditing(true)}
            aria-label='Edit quest'
            title='Edit'
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
      <div className='flex items-center gap-sm' style={{ flexWrap: 'wrap' }}>
        {isSeries ? (
          // No visible "Date" text — the calendar icon stands in for it,
          // matching the member-facing detail view (mobile/Quests.jsx). A
          // visually-hidden <label> keeps the select's accessible name
          // intact; the select itself sizes to its content/maxWidth rather
          // than stretching the full row width.
          <>
            <AddToCalendar
              quest={selected}
              dateLabel={formatEventDate(selected.eventDate)}
              showLabel={false}
              className='quest-meta-row quest-meta-link'
              style={{ flex: 'none', display: 'inline-flex', alignItems: 'center' }}
            />
            <label className='visually-hidden' htmlFor='org-quest-date-select'>
              Date
            </label>
            <select
              id='org-quest-date-select'
              className='quest-date-select'
              style={{ flex: 'none', maxWidth: 200 }}
              value={selectedId}
              onChange={(e) => a.switchDate(e.target.value)}
            >
              {occurrences.map((o) => (
                <option key={o.id} value={o.id}>
                  {formatEventDate(o.eventDate)}
                </option>
              ))}
            </select>
          </>
        ) : (
          formatEventDate(selected.eventDate) && (
            <AddToCalendar
              quest={selected}
              dateLabel={formatEventDate(selected.eventDate)}
              className='quest-meta-row quest-meta-link'
            />
          )
        )}
      </div>
      {/* Same as the quest's own map detail (MapQuestDetailBody.jsx) — this
          used to link to this app's own /map view instead, but an org
          checking their own quest's location wants driving directions
          there, not a re-pan of the in-app map. */}
      <LocationLink location={selected.location} lat={selected.lat} lng={selected.lng} />
      <div className='flex items-center gap-sm' style={{ flexWrap: 'wrap' }}>
        <button
          type='button'
          onClick={a.toggleAttendees}
          disabled={a.busy}
          className='quest-meta-row quest-meta-link'
        >
          <IconUsers />{' '}
          {selected.capacity
            ? `${rsvpCount} / ${selected.capacity} spots filled`
            : `${rsvpCount} RSVP'd`}
        </button>
      </div>
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
          <StampButton type='button' variant='primary' onClick={a.generateQr} disabled={a.qrBusy}>
            {a.qrBusy ? 'Generating…' : 'Generate QR Code'}
          </StampButton>
        ) : (
          <StampButton type='button' variant='primary' onClick={a.viewQr} disabled={a.qrBusy}>
            {a.qrOpen ? 'Hide QR Code' : 'View QR Code'}
          </StampButton>
        )}
      </div>
      {a.qrError && <p className='box-danger'>{a.qrError}</p>}
      {a.qrOpen && a.qr && (
        <LightboxBackdrop onClose={a.viewQr} label='Event check-in QR code'>
          <div className='ink-card qr-modal-content' onClick={(e) => e.stopPropagation()}>
            <img src={a.qr} alt='Event check-in QR code' className='qr-modal-image' />
            <p className='data-stat'>Attendees scan this from the app's Check In screen.</p>
            <div className='flex gap-sm' style={{ marginTop: 10, justifyContent: 'center' }}>
              <StampButton as='a' href={a.qr} download={`quest-${selected.id}-qr.png`}>
                Download
              </StampButton>
              <StampButton
                type='button'
                onClick={() => setConfirmingRefresh(true)}
                disabled={a.qrBusy}
              >
                Regenerate
              </StampButton>
            </div>
          </div>
        </LightboxBackdrop>
      )}
      {/* Its own stacked popup rather than growing the QR modal above —
          confirming/cancelling here never changes that modal's size. */}
      {confirmingRefresh && (
        <LightboxBackdrop onClose={() => setConfirmingRefresh(false)} label='Confirm regenerate QR code'>
          <div className='qr-modal-content' onClick={(e) => e.stopPropagation()}>
            <ConfirmBox
              message="This invalidates the current code — anyone with the old one (printed, screenshotted, still on a poster) won't be able to check in with it anymore."
              confirmLabel={a.qrBusy ? 'Working…' : 'Yes, regenerate'}
              submitting={a.qrBusy}
              onConfirm={() => {
                a.refreshQr();
                setConfirmingRefresh(false);
              }}
              onCancel={() => setConfirmingRefresh(false)}
            />
          </div>
        </LightboxBackdrop>
      )}

      {a.attendeesOpen && a.attendees && (
        <LightboxBackdrop onClose={a.toggleAttendees} label='Attendees'>
          <div
            className='ink-card detail-modal-content quest-attendees-modal'
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 18px' }}>Attendees</h3>
            {a.attendees.length === 0 ? (
              <p className='field-optional'>No RSVPs yet.</p>
            ) : (
              // A grid of centered cards rather than QuestReviewsList's own
              // left-aligned rows (see .map-review-* in style.css) — that
              // row layout left a lot of dead space once this modal grew
              // wider than the shared .detail-modal-content default (see
              // .quest-attendees-modal); a name/email/status pill has no
              // long body text underneath it the way a review does, so a
              // compact centered card reads faster at a glance and actually
              // uses the extra width instead of just padding a single
              // column out.
              <div className='attendee-grid'>
                {a.attendees.map((att) => (
                  <div key={att.uid} className='attendee-card'>
                    <div className='attendee-card-avatar'>
                      <OrgAvatar name={att.name || 'Unnamed'} seed={att.uid} />
                    </div>
                    <p className='attendee-card-name'>{att.name || 'Unnamed'}</p>
                    {att.email && <p className='attendee-card-email'>{att.email}</p>}
                    <StatusStamp tone='environment' muted={att.status !== 'checked_in'}>
                      {att.status === 'checked_in' ? 'Checked in' : 'Not checked in'}
                    </StatusStamp>
                  </div>
                ))}
              </div>
            )}
          </div>
        </LightboxBackdrop>
      )}

      {/* Hidden entirely with nothing to show — matches the quest's own map
          detail (MapQuestDetailBody.jsx), which gates its Reviews tab the
          same way. No expand/collapse toggle otherwise: shown inline,
          same as the volunteer-facing detail (mobile/Quests.jsx), all
          three sharing QuestReviewsList. */}
      {series.reviewCount > 0 && (
        <div className='quest-expand-section' style={{ paddingTop: 12 }}>
          <p className='quest-title' style={{ fontSize: '0.95rem', margin: '0 0 10px' }}>Reviews</p>
          <QuestReviewsList questId={selected.id} reviewCount={series.reviewCount} />
        </div>
      )}
    </div>
  );
}

// The soonest occurrence in a series that hasn't happened yet, or null if
// every occurrence has already passed — `series.occurrences` is already
// sorted ascending by eventDate (see groupBySeries), so the first upcoming
// one found is the soonest. A recurring series can have some occurrences
// past and others still upcoming; this is what "is this series still
// active" actually means for one, not just checking its `primary` (the
// earliest occurrence), which could be long past for an ongoing series.
function nextOccurrence(series) {
  return series.occurrences.find(isUpcoming) || null;
}

// Active/upcoming series first (soonest next occurrence first — what the
// org needs to act on next), then past series after them, most recently
// finished first — a past series someone might still want to check in on
// (reviews, attendance) stays reachable rather than disappearing, just
// pushed to the end and (see QuestSeriesListItem's data-past) rendered
// de-emphasized like sideQuestGate's own dimmed-but-still-clickable rows.
function compareSeriesForOrgList(a, b) {
  const aNext = nextOccurrence(a);
  const bNext = nextOccurrence(b);
  if (aNext && bNext) return toDate(aNext.eventDate) - toDate(bNext.eventDate);
  if (aNext) return -1;
  if (bNext) return 1;
  const aLast = a.occurrences[a.occurrences.length - 1];
  const bLast = b.occurrences[b.occurrences.length - 1];
  return toDate(bLast.eventDate) - toDate(aLast.eventDate);
}

// A handful of hints to rotate through — title first (the common case),
// location second, so it's clear both fields are searchable even though
// neither is spelled out in the placeholder text itself.
const ORG_SEARCH_PLACEHOLDERS = ['Search your quests', 'Try a title', 'Try a location'];

function OrgQuests({ creating, setCreating }) {
  const { user } = useAuth();
  const isDesktop = useIsDesktop();
  const [quests, setQuests] = useState(null);
  const [seriesAggregates, setSeriesAggregates] = useState(new Map());
  const [openSeriesId, setOpenSeriesId] = useState(null);
  const [search, setSearch] = useState('');

  async function load() {
    const [questsSnap, seriesSnap] = await Promise.all([
      getDocs(query(collection(db, 'quests'), where('orgId', '==', user.uid))),
      getCachedCollection(db, 'questSeries'),
    ]);
    setQuests(questsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setSeriesAggregates(new Map(seriesSnap.docs.map((d) => [d.id, d.data()])));
  }

  useEffect(() => {
    load();
  }, [user]);

  const seriesList = useMemo(
    () => (quests
      ? attachSeriesRatings(groupBySeries(quests), seriesAggregates).sort(compareSeriesForOrgList)
      : []),
    [quests, seriesAggregates],
  );

  // Title/location only — no tags, sort, or type picker here (unlike the
  // volunteer-facing Explore Quests): an organization's own quest list is
  // already just its own quests, so there's nothing to filter by category
  // or ownership, only to find one specific quest by name or place.
  const visibleSeriesList = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return seriesList;
    return seriesList.filter((s) => {
      const { title, location } = s.primary;
      return [title, location].some((field) => (field || '').toLowerCase().includes(q));
    });
  }, [seriesList, search]);

  if (!quests) return <LoadingSpinner label='Loading your quests…' />;

  const activeSeriesId = isDesktop
    ? (openSeriesId ?? visibleSeriesList[0]?.seriesId ?? null)
    : openSeriesId;
  const activeSeries = visibleSeriesList.find((s) => s.seriesId === activeSeriesId) || null;

  async function afterCreated() {
    setCreating(false);
    await load();
  }

  const createForm = (
    <CreateQuestForm quests={quests} onCreated={afterCreated} onCancel={() => setCreating(false)} />
  );

  return (
    <div className={isDesktop ? 'quest-feed-layout' : undefined}>
      <div className='quest-feed-main'>
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
              {createForm}
            </motion.section>
          </AnimatePresence>
        )}

        {seriesList.length > 0 && (
          <div className='quest-search-row'>
            <VanishSearchInput
              value={search}
              onChange={setSearch}
              placeholders={ORG_SEARCH_PLACEHOLDERS}
              ariaLabel='Search your quests'
            />
          </div>
        )}

        {seriesList.length === 0 ? (
          <p>You haven't created any quests yet.</p>
        ) : visibleSeriesList.length === 0 ? (
          <p>Nothing matches that search.</p>
        ) : (
          <ul className='quest-list'>
            {visibleSeriesList.map((series, index) => (
              <QuestSeriesListItem
                key={series.seriesId}
                series={series}
                index={index}
                isOpen={!isDesktop && openSeriesId === series.seriesId}
                isActive={isDesktop && activeSeriesId === series.seriesId}
                onSelect={() => {
                  // Picking a quest from the list always means "show me this
                  // one" — if the create-quest form was open, it's cancelled
                  // (its draft is autosaved, so nothing is lost) rather than
                  // leaving the organizer stuck looking at the form while a
                  // different row highlights as selected underneath it.
                  setCreating(false);
                  setOpenSeriesId(
                    !isDesktop && openSeriesId === series.seriesId ? null : series.seriesId,
                  );
                }}
              >
                {!isDesktop && openSeriesId === series.seriesId && (
                  <QuestSeriesDetailPane series={series} onChanged={load} />
                )}
              </QuestSeriesListItem>
            ))}
          </ul>
        )}
      </div>

      {isDesktop && (
        <div className='ink-card quest-detail-pane'>
          {creating ? (
            <div className='quest-card-body'>{createForm}</div>
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
  const [creating, setCreating] = useState(false);

  return (
    <PageMotion>
      <TopBar
        title='Your Quests'
        hero
        actions={
          // Open-only — once the form is open, closing it is exclusively the
          // form's own Cancel button's job, so this never flips to "Cancel".
          <StampButton
            type='button'
            variant='primary'
            onClick={() => setCreating(true)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <IconPlus /> Create Quest
          </StampButton>
        }
      />
      <OrgQuests creating={creating} setCreating={setCreating} />
    </PageMotion>
  );
}
