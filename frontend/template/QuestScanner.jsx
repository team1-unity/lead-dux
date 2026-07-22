// Camera-based QR scanner — the user-facing "Scan QR Code" flow. html5-qrcode
// owns the camera permission prompt, video element, and the actual decode
// loop; this component just starts/stops a scanner instance and turns a
// successful decode into a check_in_to_event call for the CALLER themself.
//
// This used to be the organization's side of check-in (scanning each
// attendee's own personal QR) — the event-QR redesign inverted who scans
// and who's displayed, but the camera plumbing itself didn't need to
// change at all, just what a successful decode does with the payload.
//
// html5-qrcode's success callback fires on every frame that still contains
// a decodable code (several times a second while the phone is held steady),
// not once per code. busyRef guards against firing check_in_to_event
// repeatedly for the same still-in-frame code while the first call is in
// flight — check_in_to_event is itself idempotent (see main.py), so a
// duplicate call would just be wasted work, not a bug, but this avoids the
// wasted work and the flickering status message that would come with it.
import { useEffect, useId, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { callCheckInToEvent } from './fetch.jsx';

export function QuestScanner({ onCheckedIn }) {
  const elementId = `quest-scanner-${useId().replace(/:/g, '')}`;
  const busyRef = useRef(false);
  const [status, setStatus] = useState(null); // { kind: 'success' | 'error', message }

  useEffect(() => {
    const scanner = new Html5Qrcode(elementId);

    async function handleDecoded(decodedText) {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const payload = JSON.parse(decodedText);
        const result = await callCheckInToEvent({ questId: payload.questId, token: payload.token });
        setStatus({
          kind: 'success',
          message: result.alreadyCheckedIn
            ? "You're already checked in to this event."
            : `Checked in successfully! You earned ${result.pointsAwarded} Leadership Point${result.pointsAwarded === 1 ? '' : 's'}.`,
        });
        onCheckedIn?.(result);
      } catch (err) {
        setStatus({ kind: 'error', message: err.message || 'Could not validate that QR code.' });
      } finally {
        busyRef.current = false;
      }
    }

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220 },
        handleDecoded,
        () => {} // per-frame "no code found yet" — expected while aiming the camera, not an error
      )
      .catch((err) => setStatus({ kind: 'error', message: `Camera unavailable: ${err.message || err}` }));

    return () => {
      scanner.stop().catch(() => {}).finally(() => scanner.clear());
    };
  }, [elementId, onCheckedIn]);

  return (
    <div className="ink-card" style={{ marginTop: 12 }}>
      <div id={elementId} style={{ width: '100%', maxWidth: 320, margin: '0 auto' }} />
      {status && (
        <p className={status.kind === 'error' ? 'box-danger' : 'box-success'} style={{ marginTop: 10 }}>
          {status.message}
        </p>
      )}
    </div>
  );
}
