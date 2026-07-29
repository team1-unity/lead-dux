import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { useMapQuestSeries } from '@shared/useMapQuestSeries.js';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { MapQuestDetailBody } from '@shared/MapQuestDetailBody.jsx';
import { IconX } from '@shared/icons.jsx';

// The detail EventsMap's list rows/pins actually open (see App.jsx's
// backgroundLocation routing) — rendered as a genuine view switch inside
// EventsMap's own list pane (#events-map-list-pane), not a floating modal
// on top of the page: a portal straight into that specific DOM node, so it
// visually replaces the list right where it was while the map beside/above
// it stays fully visible and interactive the whole time. Only rendered
// while location.state.backgroundLocation is set; a direct load of this
// same /map/:seriesId URL renders MapQuestPage (the full standalone page)
// instead, since there's no list pane to switch inside of in that case.
//
// Does its own independent fetch (useMapQuestSeries), same as MapQuestPage —
// this view and the map/list behind it are separate route matches, not
// parent/child, so there's no in-memory list to reuse here (see
// useMapQuestSeries' own note on why that's deliberate, not a missed
// optimization).
export function MapQuestOverlay() {
  const { seriesId } = useParams();
  const navigate = useNavigate();
  const { series, notFound, error } = useMapQuestSeries(seriesId);
  // EventsMap is always already mounted (and its list pane already in the
  // DOM) by the time this renders — it's what backgroundLocation keeps
  // showing underneath — but the portal target is still looked up in an
  // effect rather than during render, since reading the DOM directly while
  // rendering is exactly the kind of thing that's fragile to a future
  // reorder of these two components' mount timing.
  const [portalTarget, setPortalTarget] = useState(null);

  useEffect(() => {
    const target = document.getElementById('events-map-list-pane');
    setPortalTarget(target);
    if (!target) return undefined;
    // .events-map-detail-slot is `position: absolute` inside this pane, not
    // `fixed` — its containing block's own scroll still carries it along,
    // so without this, scrolling the still-rendered (just visually covered)
    // list underneath drags the detail view up with it and un-covers list
    // rows past wherever it started. Locking the pane's own scroll while
    // this is mounted leaves the slot's own overflow-y:auto as the only
    // thing that can scroll, same restore-previous-value pattern
    // LightboxBackdrop.jsx uses for html/body.
    const previousOverflow = target.style.overflow;
    target.style.overflow = 'hidden';
    return () => {
      target.style.overflow = previousOverflow;
    };
  }, []);

  function close() {
    navigate(-1);
  }

  // Pushed here from a real quest row/pin, so the id should always resolve —
  // but if it doesn't (deleted between page load and click), there's
  // nothing to show; back out to the map instead of leaving an empty panel.
  useEffect(() => {
    if (notFound) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notFound]);

  // No LightboxBackdrop here (see module note — this isn't a floating
  // modal), so its Escape handling doesn't come along for free; wired up
  // directly instead.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (notFound || !portalTarget) return null;

  return createPortal(
    <div className="events-map-detail-slot">
      {!series ? (
        // No hero photo to float a close button on yet — the generic
        // bordered-card-inset .photo-lightbox-close (see style.css) covers
        // this brief loading/error state instead; MapQuestDetailBody's own
        // onClose renders one directly on the hero once it's loaded.
        <>
          <button type="button" className="photo-lightbox-close" onClick={close} aria-label="Close">
            <IconX width={18} height={18} />
          </button>
          {error ? <p className="box-danger">{error}</p> : <LoadingSpinner label="Loading quest..." />}
        </>
      ) : (
        <MapQuestDetailBody series={series} fullDetailsHref={`/quests/${series.seriesId}`} onClose={close} />
      )}
    </div>,
    portalTarget,
  );
}
