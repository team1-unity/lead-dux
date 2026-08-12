import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageMotion } from '@shared/PageMotion.jsx';
import { QuestScanner } from '@shared/QuestScanner.jsx';
import { BackLink } from '@shared/BackLink.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { DEMO_STUDENT_EMAIL } from '@shared/demoConfig.js';
import { callDemoForceCheckIn } from '@shared/fetch.jsx';

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
  const { user } = useAuth();
  const navigate = useNavigate();
  // Only ever true for the one fixed demo account (see /demo-stud) — a real
  // user is never signed in as her, so this shortcut is completely inert
  // outside a live demo, not a hidden feature anyone could stumble into.
  const isDemoStudent = user?.email === DEMO_STUDENT_EMAIL;

  // Presenting on a split screen (or anywhere with no second camera free
  // to physically scan the projected QR) — pressing "C" does exactly what
  // a real scan of the demo event would (see
  // demo_force_check_in's own module note in main.py: same attendance/
  // points/journal effect as demo_check_in, just without needing an actual
  // token), then hands off to the real CheckInConfirm success screen via
  // router state instead of a URL round trip, so it reads as a real scan
  // start to finish.
  const simulateScan = useCallback(() => {
    callDemoForceCheckIn()
      .then((res) => navigate('/check-in/demo/simulated', { state: { simulated: true, ...res } }))
      .catch(() => {});
  }, [navigate]);

  useEffect(() => {
    if (!isDemoStudent) return undefined;
    function onKeyDown(e) {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key.toLowerCase() === 'c') simulateScan();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDemoStudent, simulateScan]);

  return (
    <PageMotion>
      <BackLink to="/" label="Home" />
      <h1>Scan QR Code</h1>
      <p>Point your camera at the event's check-in code, displayed by the organization at the event.</p>
      <QuestScanner />
    </PageMotion>
  );
}
