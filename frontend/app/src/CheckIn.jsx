import { PageMotion } from '@shared/PageMotion.jsx';
import { QuestScanner } from '@shared/QuestScanner.jsx';
import { BackLink } from '@shared/BackLink.jsx';

// The user-facing half of the event-QR redesign: an organization displays
// one QR per event (see the org/admin dashboard's Generate/View/Refresh QR
// controls), and this is where an attendee scans it with this app's own
// in-app camera. Scanning that same QR with the phone's native camera app
// works too, without ever visiting this page — it's a real URL (see
// functions/main.py's _check_in_url), landing straight on
// CheckInConfirm.jsx. QuestScanner itself doesn't call check_in_to_event or
// show a result here — it just decodes the QR and navigates to that same
// URL, so CheckInConfirm.jsx is the one place that actually performs the
// check-in and shows success/error, regardless of which of the two
// scanning paths got there.
export function CheckIn() {
  return (
    <PageMotion>
      <BackLink to="/" label="Home" />
      <h1>Scan QR Code</h1>
      <p>Point your camera at the event's check-in code, displayed by the organization at the event.</p>
      <QuestScanner />
    </PageMotion>
  );
}
