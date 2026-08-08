import { useEffect, useState } from 'react';
import { useQuestSeriesActions } from './useQuestSeriesActions.js';
import { formatRecurrence } from './questSeries.js';
import { StampButton } from './StampButton.jsx';
import { AddToCalendar } from './AddToCalendar.jsx';
import { LightboxBackdrop } from './LightboxBackdrop.jsx';
import { IconShare, IconCheck } from './icons.jsx';

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
          {submitting ? 'Working…' : confirmLabel}
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
// call needed to build it: every quest doc already carries its own
// seriesId, so there's nothing to fetch that isn't already on hand here.
//
// navigator.share() (the OS's own share sheet — Messages/Mail/whatever's
// installed) when the platform supports it, same user gesture requirement
// as the old direct-to-clipboard copy. Falls back to a modal with the
// real link plus its own dedicated Copy button on desktop browsers that
// don't implement the Web Share API at all. `iconOnly` swaps the label
// for a small icon button (used inline in org/Quests.jsx's icon trio).
// `questTitle` is passed straight through to navigator.share()'s own title
// field — optional, since not every call site always has it on hand.
export function ShareButton({ seriesId, questTitle, iconOnly = false, disabled = false }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/share/${seriesId}`;

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: questTitle, url });
      } catch {
        // AbortError from the user dismissing the share sheet — not a real
        // failure, nothing to show for it.
      }
      return;
    }
    setModalOpen(true);
  }

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      {iconOnly ? (
        <button
          type="button"
          className="quest-icon-btn"
          onClick={share}
          disabled={disabled}
          aria-label="Share"
          title="Share"
        >
          <IconShare />
        </button>
      ) : (
        <StampButton type="button" onClick={share} disabled={disabled}>
          Share quest
        </StampButton>
      )}
      {modalOpen && (
        <LightboxBackdrop onClose={() => setModalOpen(false)} label="Share quest">
          <div className="detail-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="ink-card flex flex-col gap-md">
              <h3 style={{ margin: 0 }}>Share {questTitle || 'this quest'}</h3>
              <p style={{ wordBreak: 'break-all' }}>{url}</p>
              <StampButton type="button" variant="primary" onClick={copy}>
                {copied ? (
                  <>
                    <IconCheck width={16} height={16} /> Copied!
                  </>
                ) : (
                  'Copy link'
                )}
              </StampButton>
            </div>
          </div>
        </LightboxBackdrop>
      )}
    </>
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
  const [confirmingRefresh, setConfirmingRefresh] = useState(false);
  const rsvpCount = (selected.rsvpd || []).length;

  // The QR panel itself closes on a date switch (see switchDate) — this
  // just keeps the confirm step from reappearing pre-opened next time.
  useEffect(() => {
    if (!a.qrOpen) setConfirmingRefresh(false);
  }, [a.qrOpen]);

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
      {/* Side quests' "location" is a generic prompt ("Any local park"),
          not a real place — left out of this row for the same reason
          LocationLink is skipped for them elsewhere (mobile/Quests.jsx,
          MapQuestDetailBody.jsx). */}
      {!primary.isDefault && selected.location && <p className="data-row-sub">{selected.location}</p>}
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
          <ShareButton seriesId={primary.seriesId} questTitle={primary.title} disabled={a.busy} />
        )}
        {/* Every quest created from now on already has a qrToken minted at
            creation time (see _quest_doc_fields) — "Generate" only ever
            shows for quests that predate that change. */}
        {!selected.qrToken ? (
          <StampButton type="button" variant="primary" onClick={a.generateQr} disabled={a.qrBusy}>
            {a.qrBusy ? 'Generating…' : 'Generate QR Code'}
          </StampButton>
        ) : (
          <StampButton type="button" variant="primary" onClick={a.viewQr} disabled={a.qrBusy}>
            {a.qrOpen ? 'Hide QR Code' : 'View QR Code'}
          </StampButton>
        )}
        {!isSeries && (
          <StampButton type="button" onClick={() => a.setRecurring((v) => !v)}>
            {a.recurring ? 'Cancel' : 'Make recurring'}
          </StampButton>
        )}
        {primary.orgId && <AddToCalendar quest={selected} dateLabel={formatEventDate(selected.eventDate)} />}
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
            {a.recurSubmitting ? 'Saving…' : 'Make recurring'}
          </StampButton>
        </form>
      )}
      {a.qrError && <p className="box-danger">{a.qrError}</p>}
      {a.qrOpen && a.qr && (
        <div className="ink-card event-qr-display">
          <img src={a.qr} alt="Event check-in QR code" />
          <p className="data-stat">Attendees scan this from the app's Check In screen.</p>
          <div className="flex gap-sm" style={{ marginTop: 10, justifyContent: 'center' }}>
            <StampButton as="a" href={a.qr} download={`quest-${selected.id}-qr.png`}>
              Download
            </StampButton>
            <StampButton type="button" onClick={() => setConfirmingRefresh((v) => !v)} disabled={a.qrBusy}>
              Regenerate
            </StampButton>
          </div>
          {confirmingRefresh && (
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
          )}
        </div>
      )}
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
