import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useAuth } from './AuthContext.jsx';
import { db } from './firebaseapp.jsx';
import { callDismissNotification } from './fetch.jsx';
import { IconX } from './icons.jsx';

// Deliberately its own tiny copy rather than importing mobile/Quests.jsx's
// formatEventDate — this is a shared/ component, and every other shared/
// component is a leaf that pages import from, never the reverse.
function formatEventDate(isoOrTimestamp) {
  if (!isoOrTimestamp) return null;
  const date = isoOrTimestamp.toDate ? isoOrTimestamp.toDate() : new Date(isoOrTimestamp);
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// One line of copy per notification kind — see _notify_user in
// functions/main.py for exactly when each of these gets written
// (update_quest on a date change, delete_quest/delete_quest_series/
// keep-only-this-date on a cancellation, submit_feedback_request_response
// once an organization answers a request, approve_organization once an
// admin approves a pending org). The reschedule/cancellation copy
// explicitly says the app doesn't touch any calendar entry someone may
// have already added — see AddToCalendar.jsx's own note that it only ever
// generates a Google Calendar/.ics link, never anything this app could
// reach back into later.
function messageFor(notice) {
  const calendarNote = "This app can't remove or update anything you already added to your own calendar — please check it yourself.";
  if (notice.kind === 'quest_rescheduled') {
    return `This quest was rescheduled to ${formatEventDate(notice.newEventDate)}. Your RSVP was cleared — RSVP again if you'd still like to attend. ${calendarNote}`;
  }
  if (notice.kind === 'feedback_received') {
    return notice.pointsAwarded > 0
      ? `An organization left feedback on your journal entry for this quest, and you earned ${notice.pointsAwarded} points. View it in your Journal.`
      : `An organization left feedback on your journal entry for this quest. View it in your Journal.`;
  }
  if (notice.kind === 'org_approved') {
    return "You're now a verified organization — you can start creating quests for volunteers to join.";
  }
  return `This quest was cancelled by the organizer. ${calendarNote}`;
}

// Every other kind is about a specific quest (questTitle always set — see
// _notify_user's callers); org_approved is the one exception, with neither
// questId nor questTitle set at all.
function titleFor(notice) {
  return notice.kind === 'org_approved' ? "You're approved!" : notice.questTitle;
}

// A must-dismiss popup notice on a Home screen — mobile/Home.jsx (a
// member's own) for the two ways a quest can change out from under someone
// who already RSVP'd, and org/Home.jsx (an organization's own) for its
// one-time "you're approved" notice. Keyed purely by the signed-in user's
// own uid (see firestore.rules' identical check on this subcollection), so
// this same component works unchanged for either role — nothing here is
// user- or organization-specific. Shows one notice at a time (oldest
// first) rather than a stacked list; dismissing one reveals the next via
// the same live listener. Nothing to render until there's actually
// something to say — same "reweighted, unboxed, and deferred" instinct as
// everywhere else in this redesign.
export function NotificationBanner() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [dismissingId, setDismissingId] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    const q = query(
      collection(db, 'users', user.uid, 'notifications'),
      orderBy('createdAt', 'asc'),
    );
    return onSnapshot(q, (snap) => {
      setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [user]);

  if (notifications.length === 0) return null;
  const notice = notifications[0];

  async function dismiss() {
    setDismissingId(notice.id);
    try {
      await callDismissNotification(notice.id);
    } finally {
      setDismissingId(null);
    }
  }

  return (
    <div className="ink-card notification-banner" role="status">
      <button
        type="button"
        className="notification-banner-close"
        onClick={dismiss}
        disabled={dismissingId === notice.id}
        aria-label="Dismiss notification"
      >
        <IconX width={16} height={16} />
      </button>
      <p style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, paddingRight: 28 }}>
        {titleFor(notice)}
      </p>
      <p style={{ margin: '6px 0 0' }}>{messageFor(notice)}</p>
    </div>
  );
}
