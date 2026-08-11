import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { db } from '@shared/firebaseapp.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { TopBar } from '@shared/TopBar.jsx';
import { OrgAvatar } from '@shared/OrgAvatar.jsx';
import { StatusStamp } from '@shared/StatusStamp.jsx';
import { ConfirmBox, formatEventDate } from '@shared/QuestSeriesRow.jsx';
import { IconCheck } from '@shared/icons.jsx';
import {
  callGetDemoOrgView,
  callDemoResetEvent,
  callDemoResetStudent,
  callDemoSeedShowcase,
  callDemoRsvpStudent,
} from '@shared/fetch.jsx';

// The attendee-list/QR half still needs the Admin-SDK-resolved view (names,
// check-in status) — same reason DemoOrg used to poll this before it became
// a pure sign-in launcher. The RSVP count itself is watched separately, and
// faster, via a live listener (see the quest doc effect below) — this
// interval is just for attendees/QR staying current.
const POLL_MS = 5000;
// How long a real RSVP + this page's own answering demo_rsvp_student call
// count as "the same burst" — guards against the count-up from Jordan's own
// echo write immediately re-triggering itself. Self-healing by design (a
// plain timeout, not a flag that could get stuck): worst case is one missed
// beat if two independent RSVPs land within the window, not a stuck page.
const RSVP_ECHO_COOLDOWN_MS = 4000;
const EVENT_LOG_LIMIT = 5;

// The presenter's own backstage control screen — shown on a projector/
// second monitor while /demo-org and /demo-stud (now real, signed-in
// sessions — see those files) are what the audience actually sees. Never
// signs in as anyone itself. Three jobs: display the event's real QR code,
// react live when someone RSVPs or checks in (so the room sees "Jordan
// Ortiz just RSVP'd!" the instant it happens), and hold the Seed/Reset
// controls that keep the demo repeatable.
export function DemoOps() {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [seeding, setSeeding] = useState(false);
  const [confirmingResetEvent, setConfirmingResetEvent] = useState(false);
  const [resettingEvent, setResettingEvent] = useState(false);
  const [resettingStudent, setResettingStudent] = useState(false);
  const [events, setEvents] = useState([]);
  const reduce = useReducedMotion();

  const prevRsvpCount = useRef(null);
  const prevCheckedIn = useRef(false);
  const coolingDown = useRef(false);

  const load = useCallback(() => {
    callGetDemoOrgView()
      .then((data) => {
        setView(data);
        setError('');
      })
      .catch((err) => setError(err.message || 'Could not load the demo event.'));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  function logEvent(message) {
    setEvents((prev) => [{ id: `${Date.now()}-${Math.random()}`, message, at: Date.now() }, ...prev].slice(0, EVENT_LOG_LIMIT));
  }

  // The live "Jordan RSVPs" beat — fires this page's own demo_rsvp_student
  // call plus the on-screen confirmation, whether triggered by the real
  // listener below or the keyboard-shortcut failsafe. Cooldown-guarded so
  // the write this itself makes (which bumps rsvpd again) can't loop.
  const triggerJordanRsvp = useCallback(() => {
    if (coolingDown.current) return;
    coolingDown.current = true;
    setTimeout(() => {
      coolingDown.current = false;
    }, RSVP_ECHO_COOLDOWN_MS);
    callDemoRsvpStudent().catch(() => {});
    logEvent("Jordan Ortiz just RSVP'd to the event.");
  }, []);

  // A live Firestore listener, not the 5s poll above — quests/{id} is
  // publicly readable (firestore.rules' `allow get: if true`, same rule
  // SharedQuest.jsx relies on), so this reacts within a second of anyone
  // RSVPing through the real app, not on the next poll tick.
  useEffect(() => {
    if (!view?.quest?.id) return undefined;
    return onSnapshot(doc(db, 'quests', view.quest.id), (snap) => {
      const count = (snap.data()?.rsvpd || []).length;
      if (prevRsvpCount.current !== null && count > prevRsvpCount.current && !coolingDown.current) {
        triggerJordanRsvp();
      }
      prevRsvpCount.current = count;
    });
  }, [view?.quest?.id, triggerJordanRsvp]);

  // Check-in has no public listener available (attendance reads require
  // auth — see firestore.rules), so this rides the same 5s poll as the
  // attendee list. Every check-in on this quest is Jordan's by design (see
  // demo_check_in), so "anyone just became checked_in" IS "Jordan checked
  // in" — no identity check needed.
  useEffect(() => {
    const nowCheckedIn = (view?.attendees || []).some((a) => a.status === 'checked_in');
    if (nowCheckedIn && !prevCheckedIn.current) {
      logEvent('Jordan Ortiz just checked in.');
    }
    prevCheckedIn.current = nowCheckedIn;
  }, [view?.attendees]);

  // Failsafe keyboard shortcut — presses of "r" trigger the exact same
  // beat as a real RSVP, in case the audience's phone/network doesn't
  // cooperate live. Ignored while typing in a form field, though this page
  // doesn't currently have one. The equivalent shortcut for check-in ("c")
  // lives on the real scanner screen instead (CheckIn.jsx, demo-student-
  // only) — that's the page it actually stands in for, and it hands off to
  // the real CheckInConfirm success screen, not a copy of it here.
  useEffect(() => {
    function onKeyDown(e) {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key.toLowerCase() === 'r') triggerJordanRsvp();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [triggerJordanRsvp]);

  async function handleResetEvent() {
    setResettingEvent(true);
    try {
      await callDemoResetEvent();
      setConfirmingResetEvent(false);
      prevRsvpCount.current = null;
      prevCheckedIn.current = false;
      setEvents([]);
      load();
    } catch (err) {
      setError(err.message || 'Could not reset the event.');
    } finally {
      setResettingEvent(false);
    }
  }

  async function handleResetStudent() {
    setResettingStudent(true);
    try {
      await callDemoResetStudent();
      logEvent("Jordan Ortiz's profile was reset.");
    } catch (err) {
      setError(err.message || "Could not reset Jordan's account.");
    } finally {
      setResettingStudent(false);
    }
  }

  async function handleSeed() {
    setSeeding(true);
    setError('');
    try {
      await callDemoSeedShowcase();
      load();
    } catch (err) {
      setError(err.message || 'Could not seed demo data.');
    } finally {
      setSeeding(false);
    }
  }

  if (!view && !error) return <LoadingSpinner label="Loading demo controls…" />;

  if (!view) {
    return (
      <PageMotion>
        <div className="ink-card">
          <p className="box-danger">{error}</p>
          <StampButton type="button" variant="primary" onClick={handleSeed} disabled={seeding} style={{ marginTop: 10 }}>
            {seeding ? 'Seeding…' : 'Seed Demo Data'}
          </StampButton>
        </div>
      </PageMotion>
    );
  }

  const { org, quest, attendees, qr } = view;
  const eventDateLabel = formatEventDate(quest.eventDate);
  const latestEvent = events[0];

  return (
    <PageMotion>
      <TopBar title="Demo Ops" hero />
      <p className="field-optional" style={{ marginTop: -8 }}>
        Backstage control screen — press <strong>R</strong> anytime to trigger Jordan's RSVP manually.
        (To simulate a QR scan/check-in, press <strong>C</strong> on the real Check In screen while
        signed in as Jordan — see /demo-stud.)
      </p>

      <AnimatePresence>
        {latestEvent && (
          <motion.div
            key={latestEvent.id}
            className="ink-card check-in-confirmation"
            style={{ marginBottom: 16 }}
            initial={reduce ? false : { opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ type: 'spring', duration: 0.5, bounce: 0.3 }}
          >
            <span className="check-in-confirmation-icon" data-tone="success">
              <IconCheck width={28} height={28} />
            </span>
            <p style={{ margin: 0, fontWeight: 600 }}>{latestEvent.message}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="ink-card quest-card-body">
        <div className="flex items-center gap-sm" style={{ marginBottom: 8 }}>
          <OrgAvatar name={org.name} logoUrl={org.logoUrl} />
          <div>
            <p className="quest-title" style={{ margin: 0 }}>
              {quest.title}
            </p>
            {org.name && (
              <p className="quest-org-line" style={{ margin: 0 }}>
                {org.name}
              </p>
            )}
          </div>
        </div>
        {eventDateLabel && <p className="quest-meta-row">{eventDateLabel}</p>}
        <p className="data-stat" style={{ margin: '8px 0 0' }}>
          {quest.rsvpCount} RSVP{quest.rsvpCount === 1 ? '' : "'d"}
        </p>

        <div className="quest-expand-section" style={{ paddingTop: 12 }}>
          <p className="quest-title" style={{ fontSize: '0.95rem', margin: '0 0 10px' }}>
            Attendees
          </p>
          {attendees.length === 0 ? (
            <p className="field-optional">No RSVPs yet.</p>
          ) : (
            <div className="attendee-grid">
              {attendees.map((att) => (
                <div key={att.uid} className="attendee-card">
                  <div className="attendee-card-avatar">
                    <OrgAvatar name={att.name || 'Unnamed'} seed={att.uid} />
                  </div>
                  <p className="attendee-card-name">{att.name || 'Unnamed'}</p>
                  <StatusStamp tone="environment" muted={att.status !== 'checked_in'}>
                    {att.status === 'checked_in' ? 'Checked in' : 'Not checked in'}
                  </StatusStamp>
                </div>
              ))}
            </div>
          )}
        </div>

        {qr && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <img src={qr} alt="Event check-in QR code" className="qr-modal-image" />
            <p className="data-stat">Scan this to check in — any scan is credited to Jordan Ortiz.</p>
            <StampButton as="a" variant="primary" href={qr} download={`quest-${quest.id}-qr.png`} style={{ marginTop: 8 }}>
              Download QR
            </StampButton>
          </div>
        )}
      </div>

      {error && <p className="box-danger">{error}</p>}

      <div className="ink-card" style={{ marginTop: 16 }}>
        <p className="quest-title" style={{ fontSize: '0.95rem', margin: '0 0 10px' }}>
          Demo Controls
        </p>
        <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
          {!confirmingResetEvent && (
            <StampButton type="button" variant="danger" onClick={() => setConfirmingResetEvent(true)}>
              Reset Event
            </StampButton>
          )}
          <StampButton type="button" onClick={handleResetStudent} disabled={resettingStudent}>
            {resettingStudent ? 'Resetting…' : "Reset Jordan's Account"}
          </StampButton>
          <StampButton type="button" onClick={handleSeed} disabled={seeding}>
            {seeding ? 'Seeding…' : 'Seed / Reseed Demo Data'}
          </StampButton>
        </div>
        {confirmingResetEvent && (
          <ConfirmBox
            message="This clears every RSVP and check-in for this event and reschedules it to right now — use it to reset before a run-through."
            confirmLabel={resettingEvent ? 'Resetting…' : 'Yes, reset'}
            submitting={resettingEvent}
            onConfirm={handleResetEvent}
            onCancel={() => setConfirmingResetEvent(false)}
          />
        )}
      </div>

      {events.length > 0 && (
        <div className="ink-card" style={{ marginTop: 16 }}>
          <p className="quest-title" style={{ fontSize: '0.95rem', margin: '0 0 10px' }}>
            Recent activity
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {events.map((e) => (
              <li key={e.id} className="data-stat">
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </PageMotion>
  );
}
