import { useEffect, useRef } from 'react';
import { loadMapsLibrary, loadMarkerLibrary } from './googleMaps.js';
import { MAP_STYLE, questPinIcon } from './mapStyle.js';

// A small, single-pin embedded map for the standalone/public quest-detail
// pages (MapQuestPage.jsx, MapQuestShare.jsx) — those don't sit next to
// EventsMap's own big multi-pin map, so each renders its own tiny one,
// initialized centered on just this one quest (mirrors the Google Maps
// place-detail page's own re-centered map). MapQuestOverlay.jsx doesn't use
// this — it floats over/beside EventsMap's already-panned map instead, so a
// second map instance there would be redundant.
export function SinglePinMap({ lat, lng, seed }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || lat == null || lng == null) return undefined;
    let cancelled = false;
    Promise.all([loadMapsLibrary(), loadMarkerLibrary()]).then(([{ Map }, { Marker }]) => {
      if (cancelled || !containerRef.current) return;
      const map = new Map(containerRef.current, {
        center: { lat, lng },
        zoom: 15,
        styles: MAP_STYLE,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: 'cooperative',
      });
      // eslint-disable-next-line no-new
      new Marker({ map, position: { lat, lng }, icon: questPinIcon(seed) });
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, seed]);

  if (lat == null || lng == null) return null;
  return <div className="single-pin-map" ref={containerRef} />;
}
