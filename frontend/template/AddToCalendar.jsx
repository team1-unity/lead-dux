import { useState } from 'react';
import { buildGoogleCalendarUrl, buildOutlookCalendarUrl, buildIcsContent, icsDataUri, questToCalendarEvent } from './calendar.js';
import { StampButton } from './StampButton.jsx';

// A dropdown of "add this occurrence to your calendar" links. Google and
// Outlook open a prefilled compose screen in a new tab; the ICS link opens
// or downloads a .ics file, which is how Apple Calendar (and Outlook
// desktop) import an event.
export function AddToCalendar({ quest }) {
  const [open, setOpen] = useState(false);

  if (!quest.eventDate) return null;

  const event = questToCalendarEvent(quest);
  const ics = buildIcsContent(event, { uid: quest.id });

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <StampButton type="button" onClick={() => setOpen((v) => !v)}>
        Add to calendar
      </StampButton>
      {open && (
        <div
          className="ink-card"
          style={{
            position: 'absolute',
            zIndex: 5,
            marginTop: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minWidth: 200,
          }}
        >
          <a href={buildGoogleCalendarUrl(event)} target="_blank" rel="noreferrer">
            Google Calendar
          </a>
          <a href={buildOutlookCalendarUrl(event)} target="_blank" rel="noreferrer">
            Outlook
          </a>
          <a href={icsDataUri(ics)} download={`${event.title}.ics`}>
            Apple Calendar / ICS download
          </a>
        </div>
      )}
    </div>
  );
}
