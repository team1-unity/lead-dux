// Camera-based QR scanner — the user-facing "Scan QR Code" flow. html5-qrcode
// owns the camera permission prompt, video element, and the actual decode
// loop; this component just starts/stops a scanner instance and navigates
// to whatever check-in URL a successful decode contains — the exact same
// URL a phone's native camera app would open scanning the same QR (see
// functions/main.py's _check_in_url). CheckInConfirm.jsx is the one place
// that actually calls check_in_to_event and shows success/error, so a code
// decoded here behaves identically to one opened outside the app entirely
// — this component doesn't duplicate any of that.
//
// This used to be the organization's side of check-in (scanning each
// attendee's own personal QR) — the event-QR redesign inverted who scans
// and who's displayed, but the camera plumbing itself didn't need to
// change at all, just what a successful decode does with the result.
//
// html5-qrcode's success callback fires on every frame that still contains
// a decodable code (several times a second while the phone is held
// steady), not once per code. busyRef guards against navigating twice for
// the same still-in-frame code in the brief window before this component
// unmounts (navigate() usually moves away before a second frame arrives
// anyway, but there's no reason to rely on that timing).
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';

// Matches the /check-in/:questId/:token path out of a full check-in URL —
// works regardless of which domain is embedded (a QR always encodes the
// real production Hosting URL, see CHECKIN_BASE_URL, but this app might be
// running on localhost/a preview channel during dev) since navigate()
// below only ever uses the path, never the scanned domain itself.
const CHECK_IN_PATH_RE = /\/check-in\/([^/?#]+)\/([^/?#]+)/;

export function QuestScanner() {
  const elementId = `quest-scanner-${useId().replace(/:/g, '')}`;
  const navigate = useNavigate();
  const busyRef = useRef(false);
  // A plain string, not the old { kind, message } shape — this component
  // never shows a *success* message of its own anymore (a successful scan
  // just navigates away), so the only thing left to render here is an
  // error.
  const [error, setError] = useState(null);

  useEffect(() => {
    const scanner = new Html5Qrcode(elementId);

    function handleDecoded(decodedText) {
      if (busyRef.current) return;
      const match = decodedText.match(CHECK_IN_PATH_RE);
      if (!match) {
        // Some other, unrelated QR code — not one of this app's own
        // check-in links. Left recoverable (scanning keeps running) rather
        // than a dead end, since aiming a camera at the wrong code for a
        // moment is an easy accident, not a reason to stop scanning.
        setError("That doesn't look like a Lead-Dux check-in code.");
        return;
      }
      busyRef.current = true;
      const [, questId, token] = match;
      navigate(`/check-in/${questId}/${token}`);
    }

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220 },
        handleDecoded,
        () => {} // per-frame "no code found yet" — expected while aiming the camera, not an error
      )
      .catch((err) => setError(`Camera unavailable: ${err.message || err}`));

    return () => {
      scanner.stop().catch(() => {}).finally(() => scanner.clear());
    };
  }, [elementId, navigate]);

  return (
    <div className="ink-card quest-scanner">
      <div id={elementId} className="quest-scanner-video" />
      {/* Overlaid on top of the live camera feed (not below it) and
          pinned near the top of the frame, so it's the first thing
          visible without looking away from — or scrolling past — the
          camera itself. */}
      {error && <p className="quest-scanner-error box-danger">{error}</p>}
    </div>
  );
}
