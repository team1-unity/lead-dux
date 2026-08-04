import { useState } from 'react';
import { buildGoogleCalendarUrl, buildIcsContent, icsDataUri, questToCalendarEvent } from './calendar.js';
import { IconCalendar, IconCheck } from './icons.jsx';
import { useAuth } from './AuthContext.jsx';

// The calendar icon (with an optional date label next to it) IS the "add
// to calendar" action — same idea as the quest location linking straight
// out to Google Maps directions (see mapLinks.js's buildDirectionsUrl)
// rather than offering a picker, and there's no separate button anymore.
// Clicking copies `dateLabel` to the clipboard — a quick fallback in case
// the redirect below doesn't prefill correctly — and, in the same click,
// either opens a prefilled Google Calendar event (users signed into
// Lead-dux with a Google account) or downloads an .ics file (everyone
// else — which Outlook desktop, Apple Calendar, and Outlook/Google web's
// own "import" flow all know how to open). `showLabel=false` renders a
// bare icon (used next to the recurring-occurrence <select>, where the
// select's own value already shows the date); `dateLabel` is still
// required in that case since it's what gets copied. `className`/`style`
// pass through so a caller (see org/Quests.jsx, mobile/Quests.jsx) can
// match the surrounding row's look.
export function AddToCalendar({ quest, dateLabel, showLabel = true, className, style }) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  if (!quest.eventDate) return null;

  const event = questToCalendarEvent(quest);
  const signedInWithGoogle = user?.providerData?.some((p) => p.providerId === 'google.com');

  const linkProps = signedInWithGoogle
    ? { href: buildGoogleCalendarUrl(event), target: '_blank', rel: 'noreferrer' }
    : { href: icsDataUri(buildIcsContent(event, { uid: quest.id })), download: `${event.title}.ics` };

  // Doesn't preventDefault — the browser still follows the link/download
  // right after. The click is the user gesture the Clipboard API needs,
  // same reasoning as ShareButton's copy-on-click (see QuestSeriesRow.jsx).
  async function handleClick() {
    await navigator.clipboard.writeText(dateLabel);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <a
      {...linkProps}
      onClick={handleClick}
      className={className}
      style={style}
      aria-label={showLabel ? undefined : 'Add to calendar'}
      title={showLabel ? undefined : 'Add to calendar'}
    >
      {copied ? <IconCheck /> : <IconCalendar />}
      {showLabel && ` ${dateLabel}`}
    </a>
  );
}
