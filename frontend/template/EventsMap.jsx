import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebaseapp.jsx';
import { useAuth } from './AuthContext.jsx';
import { groupBySeries, attachSeriesRatings, isUpcoming, toDate } from './questSeries.js';
import { loadMapsLibrary, loadMarkerLibrary } from './googleMaps.js';
import { hashTone, TONE_HEX } from './tagTones.js';
import { TopBar } from './TopBar.jsx';
import { PageMotion } from './PageMotion.jsx';
import { LoadingSpinner } from './LoadingSpinner.jsx';
import { StampButton } from './StampButton.jsx';
import { OrgAvatar } from './OrgAvatar.jsx';
import { IconPin, IconCalendar } from './icons.jsx';

// Continental-US center — only ever shown when geolocation is denied/
// unavailable AND no quest with coordinates exists to center on instead,
// so this is a last-resort fallback, not the common case.
const FALLBACK_CENTER = { lat: 39.8283, lng: -98.5795 };
const EARTH_RADIUS_KM = 6371;

// A custom JSON style (the classic per-feature stylers array) rather than a
// Cloud Console Map ID — this works on the plain raster map with zero
// extra setup, and gets the same "doesn't look like default Google Maps"
// result: recolored to the app's own paper/ink palette (see style.css's
// --paper/--line/--accent tokens) and stripped of the business/POI icon
// clutter that would otherwise compete with our own quest pins.
const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#f4f1ea' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#5c6355' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f4f1ea' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f4f1ea' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c3d6cd' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#ece7d9' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#ece7d9' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#5c6355' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#d8d2bf' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
];

// A bold colored pin per quest, echoing the same tone (via the same
// hashTone(orgId) seed) as that quest's OrgAvatar tile elsewhere on this
// page — the marker and the list row it corresponds to visibly match.
// Google's stock red teardrop reads as "generic map," not "a quest is
// here"; this is a chunkier, ink-bordered pin with a solid center dot
// matching the app's own neobrutalist ink-card look, built as an SVG data
// URI since Marker icons can't reference our CSS custom properties directly.
function questPinIcon(seed) {
  const tone = TONE_HEX[hashTone(seed)];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 30">
    <path d="M12 1C5.925 1 1 5.925 1 12c0 8.5 11 16.5 11 16.5S23 20.5 23 12C23 5.925 18.075 1 12 1z"
      fill="${tone.fill}" stroke="${tone.ink}" stroke-width="2"/>
    <circle cx="12" cy="12" r="4.5" fill="${tone.ink}"/>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(30, 37),
    anchor: new window.google.maps.Point(15, 37),
  };
}

function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function formatDistance(km) {
  if (km == null) return null;
  const miles = km * 0.621371;
  return miles < 0.1 ? 'Here' : `${miles.toFixed(1)} mi`;
}

function formatEventDate(value) {
  if (!value) return null;
  return toDate(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// A DoorDash-style "what's near me" view for quests, rather than the plain
// feed (Quests.jsx) — the two are deliberately separate screens: this one
// answers "where," the feed answers "what." Only quests with real
// coordinates show up here at all (see functions/main.py's
// _quest_doc_fields note) — side/default "anywhere" quests aren't tied to
// one point, so they're correctly absent, not a bug.
export function EventsMap() {
  const { user, loading } = useAuth();
  const [seriesList, setSeriesList] = useState(null);
  const [userPos, setUserPos] = useState(null);
  const [locationState, setLocationState] = useState('idle'); // idle | granted | denied | unavailable
  const [selectedSeriesId, setSelectedSeriesId] = useState(null);
  const [mapReady, setMapReady] = useState(false);

  const mapContainerRef = useRef(null);
  const mapObjRef = useRef(null);
  const markerCtorRef = useRef(null);
  const markersRef = useRef(new Map());
  const userMarkerRef = useRef(null);
  const hasCenteredOnUserRef = useRef(false);

  function requestLocation() {
    if (!navigator.geolocation) {
      setLocationState('unavailable');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationState('granted');
      },
      () => setLocationState('denied'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  useEffect(requestLocation, []);

  useEffect(() => {
    if (!user) return;
    Promise.all([getDocs(collection(db, 'quests')), getDocs(collection(db, 'questSeries'))]).then(
      ([questsSnap, seriesSnap]) => {
        const quests = questsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const seriesAgg = new Map(seriesSnap.docs.map((d) => [d.id, d.data()]));
        const groups = attachSeriesRatings(groupBySeries(quests), seriesAgg).filter(
          (g) => isUpcoming(g.primary) && g.primary.lat != null && g.primary.lng != null,
        );
        setSeriesList(groups);
      },
    );
  }, [user]);

  const withDistance = useMemo(() => {
    if (!seriesList) return [];
    return [...seriesList]
      .map((g) => ({
        ...g,
        distanceKm: userPos ? haversineKm(userPos, { lat: g.primary.lat, lng: g.primary.lng }) : null,
      }))
      .sort((a, b) => {
        if (a.distanceKm == null && b.distanceKm == null) return toDate(a.primary.eventDate) - toDate(b.primary.eventDate);
        if (a.distanceKm == null) return 1;
        if (b.distanceKm == null) return -1;
        return a.distanceKm - b.distanceKm;
      });
  }, [seriesList, userPos]);

  const selected = withDistance.find((g) => g.seriesId === selectedSeriesId) || null;

  // Create the map exactly once, as soon as the container div exists — not
  // gated on quests/location being ready yet, so the map itself appears
  // immediately and markers just populate a moment later.
  useEffect(() => {
    if (!mapContainerRef.current || mapObjRef.current) return;
    let cancelled = false;
    Promise.all([loadMapsLibrary(), loadMarkerLibrary()]).then(([{ Map }, { Marker }]) => {
      if (cancelled || !mapContainerRef.current) return;
      // The classic Marker, not AdvancedMarkerElement — the latter silently
      // refuses to render at all without a Map ID (a specific resource
      // created in the Cloud Console's Map Management page, not an
      // arbitrary string), confirmed via the runtime's own console warning.
      // Marker needs no such setup and is still fully supported.
      markerCtorRef.current = Marker;
      mapObjRef.current = new Map(mapContainerRef.current, {
        center: FALLBACK_CENTER,
        zoom: 4,
        styles: MAP_STYLE,
        disableDefaultUI: true,
        zoomControl: true,
      });
      setMapReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-sync quest markers whenever the (already-sorted) list changes.
  // Cheap to just clear and rebuild at this app's scale — no diffing.
  useEffect(() => {
    if (!mapReady) return;
    markersRef.current.forEach((marker) => {
      marker.setMap(null);
    });
    markersRef.current = new Map();

    withDistance.forEach((g) => {
      const marker = new markerCtorRef.current({
        map: mapObjRef.current,
        position: { lat: g.primary.lat, lng: g.primary.lng },
        title: g.primary.title,
        icon: questPinIcon(g.primary.orgId || g.seriesId),
      });
      marker.addListener('click', () => setSelectedSeriesId(g.seriesId));
      markersRef.current.set(g.seriesId, marker);
    });
  }, [mapReady, withDistance]);

  // The user's own position: a distinct marker, and the map recenters on
  // it exactly once (the first successful fix) — not every render, so a
  // later position update (there isn't one today, but if this ever moves
  // to watchPosition) wouldn't keep yanking the view back.
  useEffect(() => {
    if (!mapReady || !userPos) return;
    if (userMarkerRef.current) userMarkerRef.current.setMap(null);
    userMarkerRef.current = new markerCtorRef.current({
      map: mapObjRef.current,
      position: userPos,
      zIndex: 999,
      title: 'You are here',
      // A plain filled circle icon rather than a quest-pin-shaped default
      // marker — "you" should read as visually distinct from "a quest is
      // here" at a glance. window.google is guaranteed loaded by this
      // point (this effect only runs once mapReady is true).
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: '#4285F4',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 3,
      },
    });
    if (!hasCenteredOnUserRef.current) {
      mapObjRef.current.setCenter(userPos);
      mapObjRef.current.setZoom(12);
      hasCenteredOnUserRef.current = true;
    }
  }, [mapReady, userPos]);

  // Absent a live position, center on the nearest thing to "somewhere
  // useful" once quests actually load — the first upcoming quest with
  // coordinates beats the continental-US default.
  useEffect(() => {
    if (!mapReady || hasCenteredOnUserRef.current || withDistance.length === 0) return;
    mapObjRef.current.setCenter({ lat: withDistance[0].primary.lat, lng: withDistance[0].primary.lng });
    mapObjRef.current.setZoom(11);
  }, [mapReady, withDistance]);

  function focusSeries(seriesId) {
    setSelectedSeriesId(seriesId);
    const g = withDistance.find((s) => s.seriesId === seriesId);
    if (g && mapObjRef.current) {
      mapObjRef.current.panTo({ lat: g.primary.lat, lng: g.primary.lng });
      mapObjRef.current.setZoom(14);
    }
  }

  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <PageMotion>
      <TopBar title="Nearby" />

      {locationState === 'denied' || locationState === 'unavailable' ? (
        <div className="ink-card events-map-location-banner">
          <p style={{ margin: 0 }}>
            {locationState === 'denied'
              ? "Location is off, so quests aren't sorted by distance yet."
              : "This device doesn't support location."}
          </p>
          {locationState === 'denied' && (
            <StampButton type="button" onClick={requestLocation}>
              Enable location
            </StampButton>
          )}
        </div>
      ) : null}

      <div className="events-map-container" ref={mapContainerRef} />

      {selected && (
        <div className="ink-card events-map-selected">
          <div className="events-map-selected-head">
            <div className="quest-thumb">
              <OrgAvatar name={selected.primary.orgName} seed={selected.primary.orgId || selected.seriesId} />
            </div>
            <div>
              <p className="quest-title" style={{ margin: 0 }}>{selected.primary.title}</p>
              {selected.primary.orgName && <p className="quest-org-line">{selected.primary.orgName}</p>}
            </div>
          </div>
          <p className="quest-meta-row">
            <IconCalendar /> {formatEventDate(selected.primary.eventDate)}
          </p>
          <p className="quest-meta-row">
            <IconPin /> {selected.primary.location}
            {selected.distanceKm != null && ` · ${formatDistance(selected.distanceKm)}`}
          </p>
          <Link to={`/quests/${selected.seriesId}`}>
            <StampButton type="button" variant="primary">View quest</StampButton>
          </Link>
        </div>
      )}

      {seriesList === null ? (
        <LoadingSpinner label="Loading nearby quests..." />
      ) : withDistance.length === 0 ? (
        <div className="quest-empty">
          <h2>No Mappable Quests Yet</h2>
          <p>Once an organization posts a quest with a real address, it'll show up here.</p>
        </div>
      ) : (
        <div className="events-map-list">
          {withDistance.map((g) => (
            <button
              type="button"
              key={g.seriesId}
              className="ink-card events-map-list-row"
              data-active={g.seriesId === selectedSeriesId ? 'true' : undefined}
              onClick={() => focusSeries(g.seriesId)}
            >
              <div className="quest-thumb">
                <OrgAvatar name={g.primary.orgName} seed={g.primary.orgId || g.seriesId} />
              </div>
              <div className="events-map-list-meta">
                <p className="quest-title" style={{ margin: 0 }}>{g.primary.title}</p>
                <p className="quest-org-line">{g.primary.orgName}</p>
              </div>
              {g.distanceKm != null && <span className="events-map-list-distance">{formatDistance(g.distanceKm)}</span>}
            </button>
          ))}
        </div>
      )}
    </PageMotion>
  );
}
