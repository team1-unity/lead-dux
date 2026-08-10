import { useEffect, useRef } from 'react';
import { Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_STYLE_URL, createQuestPinElement } from './mapStyle.js';

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
    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [lng, lat],
      zoom: 15,
      // cooperativeGestures — a two-finger/ctrl+scroll is required to zoom
      // this small embedded map, same as Google's gestureHandling:
      // 'cooperative' — otherwise scrolling the page while the cursor
      // happens to pass over this little map would hijack the scroll into
      // a map zoom instead.
      cooperativeGestures: true,
    });
    new Marker({ element: createQuestPinElement(seed), anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(map);
    return () => map.remove();
  }, [lat, lng, seed]);

  if (lat == null || lng == null) return null;
  // data-lenis-prevent: same reasoning as EventsMap's map container — this
  // div has no CSS overflow of its own, so Lenis's nested-scroll detection
  // never notices it and would otherwise steal the wheel event that Google
  // Maps wants for scroll-to-zoom.
  return <div className="single-pin-map" ref={containerRef} data-lenis-prevent />;
}
