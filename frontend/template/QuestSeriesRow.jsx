import { useEffect, useState } from 'react';
import {
  callMakeQuestRecurring,
  callDeleteQuest,
  callDeleteQuestSeries,
  callListQuestAttendees,
  callListQuestReviews,
  callGenerateQuestFeedbackDrafts,
  callSubmitQuestFeedbackBatch,
} from './fetch.jsx';
import { formatRecurrence } from './questSeries.js';
import { StampButton } from './StampButton.jsx';
import { LoadingSpinner } from './LoadingSpinner.jsx';
import { QuestScanner } from './QuestScanner.jsx';
import { AddToCalendar } from './AddToCalendar.jsx';

const FEEDBACK_RATINGS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

// AI-drafted feedback for every checked-in attendee who doesn't already
// have feedback for this quest — one call generates the whole batch (see
// generate_quest_feedback_drafts), the org edits inline, one call sends
// the whole batch (submit_quest_feedback_batch). Re-mounts (via `key` on
// questId at the call site) whenever the selected date changes, so drafts
// never leak between occurrences.
function GiveFeedbackPanel({ questId, onSent }) {
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState(null);

  async function loadDrafts() {
    setLoading(true);
    setError('');
    try {
      const data = await callGenerateQuestFeedbackDrafts(questId);
      setDrafts(data.attendees);
    } catch (err) {
      setError(err.message || 'Could not generate feedback drafts.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questId]);

  function updateDraft(uid, field, value) {
    setDrafts((prev) => prev.map((d) => (d.uid === uid ? { ...d, [field]: value } : d)));
  }

  async function sendAll() {
    setError('');
    setSending(true);
    try {
      const result = await callSubmitQuestFeedbackBatch({
        questId,
        feedback: drafts.map((d) => ({ uid: d.uid, rating: d.rating, message: d.message })),
      });
      setSentCount(result.sentUids.length);
      onSent();
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSending(false);
    }
  }

  if (loading) return <LoadingSpinner label="Writing feedback drafts..." />;

  if (sentCount !== null) {
    return <p className="box-success">Feedback sent to {sentCount} attendee{sentCount === 1 ? '' : 's'}.</p>;
  }

  if (error && drafts.length === 0) {
    return <p className="box-danger">{error}</p>;
  }

  if (drafts.length === 0) {
    return <p style={{ marginTop: 12 }}>Everyone who checked in already has feedback.</p>;
  }

  return (
    <div className="ink-card" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>Give Feedback</h3>
      <p style={{ marginTop: 0, marginBottom: 14 }} className="data-stat">
        Reviewed by you before sending — your comments are shared with each attendee.
      </p>
      {error && <p className="box-danger">{error}</p>}
      <div className="flex flex-col gap-md">
        {drafts.map((d) => (
          <div key={d.uid} className="feedback-draft-row">
            <div className="flex justify-between items-center gap-sm" style={{ flexWrap: 'wrap' }}>
              <p style={{ margin: 0, fontWeight: 700 }}>{d.name}</p>
              <label className="flex items-center gap-sm" style={{ fontWeight: 400 }}>
                Rating
                <select value={d.rating} onChange={(e) => updateDraft(d.uid, 'rating', Number(e.target.value))}>
                  {FEEDBACK_RATINGS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <textarea value={d.message} onChange={(e) => updateDraft(d.uid, 'message', e.target.value)} />
          </div>
        ))}
      </div>
      <div className="flex gap-sm" style={{ marginTop: 14 }}>
        <StampButton type="button" onClick={loadDrafts} disabled={sending}>
          Regenerate
        </StampButton>
        <StampButton type="button" variant="primary" onClick={sendAll} disabled={sending} style={{ flex: 1 }}>
          {sending ? 'Sending...' : `Send All (${drafts.length})`}
        </StampButton>
      </div>
    </div>
  );
}

export function formatEventDate(isoOrTimestamp) {
  if (!isoOrTimestamp) return null;
  const date = isoOrTimestamp.toDate ? isoOrTimestamp.toDate() : new Date(isoOrTimestamp);
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatStars(rating) {
  const whole = Math.round(rating);
  return '★'.repeat(whole) + '☆'.repeat(5 - whole);
}

export function ConfirmBox({ message, confirmLabel, onConfirm, onCancel, submitting }) {
  return (
    <div className="ink-card" data-danger="true" style={{ marginTop: 12 }}>
      <p style={{ margin: 0 }}>{message}</p>
      <div className="flex gap-sm" style={{ marginTop: 10 }}>
        <StampButton type="button" variant="danger" disabled={submitting} onClick={onConfirm}>
          {submitting ? 'Working...' : confirmLabel}
        </StampButton>
        <StampButton type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </StampButton>
      </div>
    </div>
  );
}

// One row per series (not per date) — a recurring quest with 8 scheduled
// occurrences shows as a single row with a date selector, rather than
// flooding the list with 8 near-duplicate rows. Every action here
// (attendees/reviews/scanning/deleting) targets whichever date is
// currently selected, since those are inherently per-occurrence — nothing
// about the underlying data model changed, only how many dates are
// visually surfaced at once (see functions/main.py's module note above
// _generate_series_dates).
//
// Shared between the org dashboard (own quests only) and the admin
// dashboard (any quest, including default neighborhood ones) — the
// backend already gates every action here (delete/attendees/reviews/make
// recurring) on ownership-or-admin, so this component doesn't need its
// own permission prop; whichever caller can legally act on a quest sees
// this exact same row and feature set.
export function QuestSeriesRow({ series, onChanged, showOwner = false }) {
  const { primary, occurrences } = series;
  const [selectedId, setSelectedId] = useState(occurrences[0].id);
  const selected = occurrences.find((o) => o.id === selectedId) || occurrences[0];
  const isSeries = occurrences.length > 1;

  const [busy, setBusy] = useState(false);
  const [attendeesOpen, setAttendeesOpen] = useState(false);
  const [attendees, setAttendees] = useState(null);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [reviews, setReviews] = useState(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [recurFrequency, setRecurFrequency] = useState('weekly');
  const [recurUntil, setRecurUntil] = useState('');
  const [recurSubmitting, setRecurSubmitting] = useState(false);
  const [recurError, setRecurError] = useState('');
  const [deleteAction, setDeleteAction] = useState(null); // null | 'one' | 'keep' | 'all'
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  function switchDate(id) {
    setSelectedId(id);
    setAttendeesOpen(false);
    setReviewsOpen(false);
    setFeedbackOpen(false);
    setScanning(false);
    setDeleteAction(null);
  }

  async function toggleAttendees() {
    if (attendeesOpen) {
      setAttendeesOpen(false);
      return;
    }
    setBusy(true);
    try {
      setAttendees(await callListQuestAttendees(selected.id));
      setAttendeesOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function toggleReviews() {
    if (reviewsOpen) {
      setReviewsOpen(false);
      return;
    }
    setBusy(true);
    try {
      setReviews(await callListQuestReviews(selected.id));
      setReviewsOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleScanResult() {
    if (attendeesOpen) setAttendees(await callListQuestAttendees(selected.id));
  }

  async function makeRecurring(e) {
    e.preventDefault();
    setRecurError('');
    setRecurSubmitting(true);
    try {
      await callMakeQuestRecurring({ questId: selected.id, frequency: recurFrequency, until: recurUntil });
      setRecurUntil('');
      setRecurring(false);
      await onChanged();
    } catch (err) {
      setRecurError(err.message || 'Something went wrong.');
    } finally {
      setRecurSubmitting(false);
    }
  }

  async function deleteThisDate() {
    setDeleteSubmitting(true);
    try {
      await callDeleteQuest(selected.id);
      await onChanged();
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function keepOnlyThisDate() {
    setDeleteSubmitting(true);
    try {
      await callDeleteQuestSeries(selected.id, selected.id);
      await onChanged();
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function deleteAllInSeries() {
    setDeleteSubmitting(true);
    try {
      await callDeleteQuestSeries(selected.id);
      await onChanged();
    } finally {
      setDeleteSubmitting(false);
    }
  }

  const rsvpCount = (selected.rsvpd || []).length;

  return (
    <div className="data-row">
      <div className="data-row-head">
        <p className="data-row-title">{primary.title}</p>
        <span className="data-stat">
          {selected.capacity ? `${rsvpCount} / ${selected.capacity} spots` : `${rsvpCount} RSVP'd`}
        </span>
      </div>
      {isSeries ? (
        <label>
          Date
          <select value={selectedId} onChange={(e) => switchDate(e.target.value)}>
            {occurrences.map((o) => (
              <option key={o.id} value={o.id}>
                {formatEventDate(o.eventDate)} — {(o.rsvpd || []).length}
                {o.capacity ? `/${o.capacity}` : ''} RSVP'd
              </option>
            ))}
          </select>
        </label>
      ) : (
        formatEventDate(selected.eventDate) && <p className="data-row-sub">{formatEventDate(selected.eventDate)}</p>
      )}
      {selected.location && <p className="data-row-sub">{selected.location}</p>}
      {formatRecurrence(primary) && <p className="data-row-sub">{formatRecurrence(primary)}</p>}
      {showOwner && (
        <p className="data-row-sub">{primary.isDefault ? 'Default neighborhood quest' : primary.orgName || ''}</p>
      )}
      {series.reviewCount > 0 && (
        <p className="data-row-sub">
          {formatStars(series.avgRating)} ({series.reviewCount} review{series.reviewCount === 1 ? '' : 's'})
        </p>
      )}
      <p className="data-row-sub">{primary.description}</p>
      <div className="data-row-actions">
        <StampButton type="button" onClick={toggleAttendees} disabled={busy}>
          {attendeesOpen ? 'Hide attendees' : 'View attendees'}
        </StampButton>
        <StampButton type="button" onClick={toggleReviews} disabled={busy}>
          {reviewsOpen ? 'Hide reviews' : 'View reviews'}
        </StampButton>
        {primary.orgId && (
          <StampButton type="button" onClick={() => setFeedbackOpen((v) => !v)} disabled={busy}>
            {feedbackOpen ? 'Hide feedback' : 'Give feedback'}
          </StampButton>
        )}
        <StampButton type="button" variant="primary" onClick={() => setScanning((v) => !v)}>
          {scanning ? 'Close scanner' : 'Scan to check in'}
        </StampButton>
        {!isSeries && (
          <StampButton type="button" onClick={() => setRecurring((v) => !v)}>
            {recurring ? 'Cancel' : 'Make recurring'}
          </StampButton>
        )}
        <AddToCalendar quest={selected} />
        <StampButton
          type="button"
          variant="danger"
          onClick={() => setDeleteAction(deleteAction === 'one' ? null : 'one')}
        >
          Delete this date
        </StampButton>
        {isSeries && (
          <>
            <StampButton
              type="button"
              variant="danger"
              onClick={() => setDeleteAction(deleteAction === 'keep' ? null : 'keep')}
            >
              Keep only this date
            </StampButton>
            <StampButton
              type="button"
              variant="danger"
              onClick={() => setDeleteAction(deleteAction === 'all' ? null : 'all')}
            >
              Delete all in series
            </StampButton>
          </>
        )}
      </div>
      {deleteAction === 'one' && (
        <ConfirmBox
          message="Delete this one date, including its RSVPs and attendance. Any reviews already left for it stay part of this quest's review history. This cannot be undone."
          confirmLabel="Yes, delete this date"
          submitting={deleteSubmitting}
          onConfirm={deleteThisDate}
          onCancel={() => setDeleteAction(null)}
        />
      )}
      {deleteAction === 'keep' && (
        <ConfirmBox
          message={`This cancels the recurrence and deletes the other ${occurrences.length - 1} date${occurrences.length - 1 === 1 ? '' : 's'} in this series — only the selected date stays, as a standalone quest. This cannot be undone.`}
          confirmLabel="Yes, keep only this date"
          submitting={deleteSubmitting}
          onConfirm={keepOnlyThisDate}
          onCancel={() => setDeleteAction(null)}
        />
      )}
      {deleteAction === 'all' && (
        <ConfirmBox
          message={`This deletes all ${occurrences.length} dates in this series, including their RSVPs, attendance, and reviews. This cannot be undone.`}
          confirmLabel={`Yes, delete ${occurrences.length} events`}
          submitting={deleteSubmitting}
          onConfirm={deleteAllInSeries}
          onCancel={() => setDeleteAction(null)}
        />
      )}
      {recurring && (
        <form onSubmit={makeRecurring} className="ink-card flex flex-col gap-md" style={{ marginTop: 12 }}>
          <p style={{ margin: 0 }}>
            This date becomes the first occurrence — the remaining dates reuse its title, description, location,
            time of day, and timezone.
          </p>
          <label>
            Repeats
            <select value={recurFrequency} onChange={(e) => setRecurFrequency(e.target.value)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label>
            Until
            <input type="date" required value={recurUntil} onChange={(e) => setRecurUntil(e.target.value)} />
          </label>
          {recurError && <p className="box-danger">{recurError}</p>}
          <StampButton type="submit" variant="primary" disabled={recurSubmitting}>
            {recurSubmitting ? 'Saving...' : 'Make recurring'}
          </StampButton>
        </form>
      )}
      {scanning && <QuestScanner questId={selected.id} onCheckedIn={handleScanResult} />}
      {feedbackOpen && <GiveFeedbackPanel key={selected.id} questId={selected.id} onSent={onChanged} />}
      {attendeesOpen && attendees && (
        <ul className="data-sublist">
          {attendees.length === 0 && <li>No RSVPs yet.</li>}
          {attendees.map((a) => (
            <li key={a.uid}>
              {a.name || 'Unnamed'} — {a.email}
              {' — '}
              {a.status === 'checked_in' ? 'Checked in' : 'Not checked in'}
            </li>
          ))}
        </ul>
      )}
      {reviewsOpen && reviews && (
        <ul className="data-sublist">
          {reviews.length === 0 && <li>No reviews yet.</li>}
          {reviews.map((r) => (
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
