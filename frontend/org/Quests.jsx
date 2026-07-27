import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { AnimatePresence, motion } from 'framer-motion';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { groupBySeries, attachSeriesRatings, formatRecurrence } from '@shared/questSeries.js';
import { useQuestSeriesActions } from '@shared/useQuestSeriesActions.js';
import { useIsDesktop } from '@shared/useIsDesktop.js';
import { ConfirmBox, ShareButton, formatEventDate, formatStars } from '@shared/QuestSeriesRow.jsx';
import { TopBar } from '@shared/TopBar.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { LightboxBackdrop } from '@shared/LightboxBackdrop.jsx';
import { DuckMark } from '@shared/Logo.jsx';
import { AddToCalendar } from '@shared/AddToCalendar.jsx';
import { CreateQuestForm } from './CreateQuestForm.jsx';
import {
  IconPlus,
  IconEdit,
  IconTrash,
  IconChevron,
  IconCalendar,
  IconPin,
  IconUsers,
  IconX,
} from '@shared/icons.jsx';

// One entrance per row, staggered from the parent's transition — same
// values as mobile/Quests.jsx's own copy (not exported from there, so
// duplicated here rather than shared).
const listVariants = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

// The compact collapsed row — title, star rating, and date (same flat,
// avatar-free card style as the redesigned member-facing mobile/Quests.jsx,
// minus the org avatar since every quest here already belongs to this same
// org — no profile to link out to from its own list). Unlike that member
// view, this one still expands in place rather than navigating away —
// management actions live in the detail body, not a separate page — so the
// chevron (rather than a tap hint) is still the right affordance here.
function QuestSeriesListItem({ series, isOpen, isActive, onSelect, children }) {
  const { primary } = series;
  const eventDate = formatEventDate(primary.eventDate);
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
            {series.reviewCount > 0 && (
              <p className='quest-card-description'>
                {formatStars(series.avgRating)} ({series.reviewCount})
              </p>
            )}
            {eventDate && <p className='quest-card-description'>{eventDate}</p>}
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
          <ShareButton seriesId={primary.seriesId} iconOnly disabled={a.busy} />
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
              <IconCalendar /> {formatEventDate(selected.eventDate)}
            </p>
          )
        )}
        <AddToCalendar quest={selected} style={{ padding: '4px 10px', fontSize: '0.8rem' }} />
      </div>
      {selected.location && (
        <Link to={`/map?seriesId=${primary.seriesId}`} className='quest-meta-row quest-meta-link'>
          <IconPin /> {selected.location}
        </Link>
      )}
      <div className='flex items-center gap-sm' style={{ flexWrap: 'wrap' }}>
        <p className='quest-meta-row' style={{ margin: 0 }}>
          <IconUsers />{' '}
          {selected.capacity
            ? `${rsvpCount} / ${selected.capacity} spots filled`
            : `${rsvpCount} RSVP'd`}
        </p>
        <StampButton
          type='button'
          onClick={a.toggleAttendees}
          disabled={a.busy}
          style={{ padding: '4px 10px', fontSize: '0.8rem' }}
        >
          View Attendees
        </StampButton>
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
            <button
              type='button'
              className='photo-lightbox-close'
              onClick={a.viewQr}
              aria-label='Close'
            >
              <IconX width={18} height={18} />
            </button>
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
              confirmLabel={a.qrBusy ? 'Working...' : 'Yes, regenerate'}
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
          <div className='ink-card detail-modal-content' onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Attendees</h3>
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
            <button
              type='button'
              className='photo-lightbox-close'
              onClick={a.toggleAttendees}
              aria-label='Close'
            >
              <IconX width={18} height={18} />
            </button>
          </div>
        </LightboxBackdrop>
      )}

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

function OrgQuests({ creating, setCreating }) {
  const { user } = useAuth();
  const isDesktop = useIsDesktop();
  const [quests, setQuests] = useState(null);
  const [seriesAggregates, setSeriesAggregates] = useState(new Map());
  const [openSeriesId, setOpenSeriesId] = useState(null);

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

  if (!quests) return <LoadingSpinner label='Loading your quests...' />;

  const activeSeriesId = isDesktop
    ? (openSeriesId ?? seriesList[0]?.seriesId ?? null)
    : openSeriesId;
  const activeSeries = seriesList.find((s) => s.seriesId === activeSeriesId) || null;

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
          </motion.ul>
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
          <StampButton type='button' variant='primary' onClick={() => setCreating(true)}>
            <IconPlus /> Create Quest
          </StampButton>
        }
      />
      <OrgQuests creating={creating} setCreating={setCreating} />
    </PageMotion>
  );
}
