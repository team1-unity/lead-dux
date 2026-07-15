import { useQuestSeriesActions } from './useQuestSeriesActions.js';
import { formatRecurrence } from './questSeries.js';
import { StampButton } from './StampButton.jsx';
import { QuestScanner } from './QuestScanner.jsx';
import { AddToCalendar } from './AddToCalendar.jsx';

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
// flooding the list with 8 near-duplicate rows.
//
// Shared between the org dashboard (own quests only) and the admin
// dashboard (any quest, including default neighborhood ones) — the
// backend already gates every action here (delete/attendees/reviews/make
// recurring) on ownership-or-admin, so this component doesn't need its
// own permission prop; whichever caller can legally act on a quest sees
// this exact same row and feature set. (The org dashboard's own desktop
// Quests view uses a list-row/detail-pane split instead — see
// QuestSeriesListItem/QuestSeriesDetailPane, which share this same
// useQuestSeriesActions hook rather than duplicating its logic.)
export function QuestSeriesRow({ series, onChanged, showOwner = false }) {
  const { primary, occurrences } = series;
  const a = useQuestSeriesActions(series, onChanged);
  const { selected, selectedId, isSeries } = a;
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
        <StampButton type="button" onClick={a.toggleAttendees} disabled={a.busy}>
          {a.attendeesOpen ? 'Hide attendees' : 'View attendees'}
        </StampButton>
        <StampButton type="button" onClick={a.toggleReviews} disabled={a.busy}>
          {a.reviewsOpen ? 'Hide reviews' : 'View reviews'}
        </StampButton>
        <StampButton type="button" variant="primary" onClick={() => a.setScanning((v) => !v)}>
          {a.scanning ? 'Close scanner' : 'Scan to check in'}
        </StampButton>
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
      {a.scanning && <QuestScanner questId={selected.id} onCheckedIn={a.handleScanResult} />}
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
