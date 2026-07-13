// Camera-based QR scanner for organization check-in. html5-qrcode owns the
// camera permission prompt, video element, and the actual decode loop —
// this component just starts/stops a scanner instance and turns a
// successful decode into a check_in_attendee call.
//
// html5-qrcode's success callback fires on every frame that still contains
// a decodable code (several times a second while the phone is held steady),
// not once per code. busyRef guards against firing check_in_attendee
// repeatedly for the same still-in-frame code while the first call is in
// flight — check_in_attendee is itself idempotent (see main.py), so a
// duplicate call would just be wasted work, not a bug, but this avoids the
// wasted work and the flickering status message that would come with it.
import { useEffect, useId, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { callCheckInAttendee } from './fetch.jsx';

export function QuestScanner({ questId, onCheckedIn }) {
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
        if (payload.questId !== questId) {
          setStatus({ kind: 'error', message: 'That QR code is for a different quest.' });
          return;
        }
        const result = await callCheckInAttendee({ questId, uid: payload.uid, token: payload.token });
        const who = result.attendee.name || result.attendee.email || 'Attendee';
        setStatus({
          kind: 'success',
          message: result.alreadyCheckedIn ? `${who} was already checked in.` : `Checked in ${who}.`,
        });
        onCheckedIn?.();
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
  }, [elementId, questId, onCheckedIn]);

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
