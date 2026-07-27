import { useState } from 'react';
import { PageMotion } from '@shared/PageMotion.jsx';
import { QuestScanner } from '@shared/QuestScanner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { BackLink } from '@shared/BackLink.jsx';
import { IconCheck } from '@shared/icons.jsx';

// The user-facing half of the event-QR redesign: an organization displays
// one QR per event (see the org/admin dashboard's Generate/View/Refresh QR
// controls), and this is where an attendee scans it to check themself in.
export function CheckIn() {
  const [result, setResult] = useState(null);

  if (result && !result.alreadyCheckedIn) {
    return (
      <PageMotion>
        <BackLink to="/" label="Home" />
        <div className="ink-card check-in-confirmation">
          <span className="check-in-confirmation-icon">
            <IconCheck width={32} height={32} />
          </span>
          <h1>Checked in successfully!</h1>
          <p>
            You earned {result.pointsAwarded} Leadership Point{result.pointsAwarded === 1 ? '' : 's'}.
          </p>
          <StampButton type="button" variant="primary" onClick={() => setResult(null)}>
            Scan another code
          </StampButton>
        </div>
      </PageMotion>
    );
  }

  return (
    <PageMotion>
      <BackLink to="/" label="Home" />
      <h1>Scan QR Code</h1>
      <p>Point your camera at the event's check-in code, displayed by the organization at the event.</p>
      <QuestScanner onCheckedIn={setResult} />
    </PageMotion>
  );
}
