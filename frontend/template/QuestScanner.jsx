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
  // Distinct from `error` — this is the ordinary "browser's native camera
  // permission dialog hasn't been answered yet" wait, not a failure. Starts
  // true and flips off as soon as .start() actually settles either way, so
  // the empty video box doesn't just sit blank while that prompt is up.
  const [requesting, setRequesting] = useState(true);

  useEffect(() => {
    let scanner = null;
    // True once this effect's cleanup has run — checked inside .start()'s
    // own .then() below, not just read once here, because unmounting
    // quickly (a fast back-navigation, or the auto-navigate-on-decode
    // itself) can happen *before* .start() finishes acquiring the camera.
    // Camera startup is real hardware/permission-prompt latency, not
    // instant, and it's much more likely to still be in flight on a phone
    // than on a desktop webcam that's already warm — which is exactly why
    // this raced on mobile specifically. Calling stop() in the cleanup
    // below against a scanner that hasn't actually started yet is a no-op
    // (nothing to release yet), so without this, whatever camera stream
    // .start() goes on to acquire *after* that point never gets stopped at
    // all — an orphaned getUserMedia stream left running indefinitely.
    let unmounted = false;

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

    // getUserMedia's rejection shape (a real DOMException, surfaced here
    // via html5-qrcode) is specific enough to give a real answer instead
    // of the raw browser error text — "NotAllowedError: Permission denied"
    // reads like a crash, "Allow camera access..." reads like something to
    // actually do about it.
    function messageFor(err) {
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        return 'Camera access is turned off for Lead-Dux. Allow camera access for this site in your browser or device settings, then reload this page.';
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        return "No camera was found on this device — check-in still works by opening the event's QR link directly.";
      }
      if (name === 'NotReadableError') {
        return 'The camera is already in use by another app. Close it and reload this page.';
      }
      return `Camera unavailable: ${err?.message || err}`;
    }

    // Both the constructor and .start() itself (not just its returned
    // promise) can throw synchronously depending on the environment — e.g.
    // navigator.mediaDevices being entirely absent in an insecure context
    // or an unusual WebView. Uncaught, that propagates straight out of this
    // effect to the route-level error boundary ("This page hit a snag"),
    // which is exactly the crash a denied/missing camera permission should
    // never produce — this should always resolve to the in-page message
    // below instead.
    try {
      scanner = new Html5Qrcode(elementId);
      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 220 },
          handleDecoded,
          () => {} // per-frame "no code found yet" — expected while aiming the camera, not an error
        )
        .then(() => {
          setRequesting(false);
          // The camera only actually finished starting after this
          // component was already torn down — release it now, since the
          // cleanup below ran too early to catch it.
          if (unmounted) scanner.stop().catch(() => {}).finally(() => scanner.clear());
        })
        .catch((err) => {
          setRequesting(false);
          if (!unmounted) setError(messageFor(err));
        });
    } catch (err) {
      setRequesting(false);
      setError(messageFor(err));
    }

    return () => {
      unmounted = true;
      if (!scanner) return;
      try {
        scanner.stop().catch(() => {}).finally(() => scanner.clear());
      } catch {
        // .start() never actually got underway (e.g. it threw synchronously
        // above) — nothing running to stop.
      }
    };
  }, [elementId, navigate]);

  return (
    <div className="ink-card quest-scanner">
      <div id={elementId} className="quest-scanner-video" />
      {/* Overlaid on top of the live camera feed (not below it) and
          pinned near the top of the frame, so it's the first thing
          visible without looking away from — or scrolling past — the
          camera itself. */}
      {requesting && !error && (
        <p className="quest-scanner-status">Requesting camera access…</p>
      )}
      {error && <p className="quest-scanner-error box-danger">{error}</p>}
    </div>
  );
}
