import { useEffect, useState } from 'react';
import { useQuestSeriesActions } from './useQuestSeriesActions.js';
import { callGenerateQuestFeedbackDrafts, callSubmitQuestFeedbackBatch } from './fetch.jsx';
import { formatRecurrence } from './questSeries.js';
import { StampButton } from './StampButton.jsx';
import { LoadingSpinner } from './LoadingSpinner.jsx';
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

// The stable public link is just `${origin}/share/{seriesId}` — seriesId
// never changes once a quest is created (see _quest_doc_fields), and
// SharedQuest.jsx is the signed-out-friendly page it points at. No backend
// call needed to "generate" it: every quest doc already carries its own
// seriesId, so there's nothing to fetch that isn't already on hand here.
export function ShareQuestBox({ seriesId }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/share/${seriesId}`;

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="ink-card share-quest-box" style={{ marginTop: 12 }}>
      <p style={{ marginTop: 0 }} className="data-stat">
        Anyone with this link can view (and sign up to RSVP to) this quest, even without an account.
      </p>
      <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
        <input
          type="text"
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          aria-label="Shareable quest link"
          style={{ flex: '1 1 260px' }}
        />
        <StampButton type="button" variant="primary" onClick={copy}>
          {copied ? 'Copied!' : 'Copy link'}
        </StampButton>
      </div>
      <p aria-live="polite" className="visually-hidden">
        {copied ? 'Link copied to clipboard' : ''}
      </p>
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
  // Not part of useQuestSeriesActions — feedback is org-only (see the
  // primary.orgId gate below) and doesn't apply to QuestSeriesListItem/
  // QuestSeriesDetailPane's split view, so it stays local to this row.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  useEffect(() => {
    setFeedbackOpen(false);
  }, [selectedId]);
  // Unlike feedback (per-date) or attendees, the share link is per-series
  // (see ShareQuestBox) — it doesn't need to reset when switchDate changes
  // which occurrence is selected.
  const [shareOpen, setShareOpen] = useState(false);
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
        {/* Reviews are an organization-quest concept — side/default quests
            have no organization to review, so there's never anything here. */}
        {primary.orgId && (
          <StampButton type="button" onClick={a.toggleReviews} disabled={a.busy}>
            {a.reviewsOpen ? 'Hide reviews' : 'View reviews'}
          </StampButton>
        )}
        {primary.orgId && (
          <StampButton type="button" onClick={() => setFeedbackOpen((v) => !v)} disabled={a.busy}>
            {feedbackOpen ? 'Hide feedback' : 'Give feedback'}
          </StampButton>
        )}
        {primary.orgId && (
          <StampButton type="button" onClick={() => setShareOpen((v) => !v)} disabled={a.busy}>
            {shareOpen ? 'Hide share link' : 'Share quest'}
          </StampButton>
        )}
        {!selected.qrToken ? (
          <StampButton type="button" variant="primary" onClick={a.generateQr} disabled={a.qrBusy}>
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
        {primary.orgId && <AddToCalendar quest={selected} />}
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
      {feedbackOpen && <GiveFeedbackPanel key={selected.id} questId={selected.id} onSent={onChanged} />}
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
      {primary.orgId && a.reviewsOpen && a.reviews && (
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
