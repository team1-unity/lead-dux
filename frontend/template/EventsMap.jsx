import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebaseapp.jsx';
import { useAuth } from './AuthContext.jsx';
import { groupBySeries, attachSeriesRatings, attachOrgLogos, isUpcoming, toDate } from './questSeries.js';
import { MAP_STYLE_URL, createQuestPinElement, createUserPositionElement, paintQuestPin } from './mapStyle.js';
import { useIsDesktop } from './useIsDesktop.js';
import { LoadingSpinner } from './LoadingSpinner.jsx';
import { StampButton } from './StampButton.jsx';
import { OrgAvatar } from './OrgAvatar.jsx';
import { DuckMark } from './Logo.jsx';
import { VanishSearchInput } from './VanishSearchInput.jsx';
import { parseSearch } from './searchTags.js';
import { FilterPill, DesktopFilterPopover, MobileFilterSheet } from './FilterPanel.jsx';
import { IconFilter, IconList } from './icons.jsx';

// How tall the sheet's own peeking sliver is when collapsed — handle bar +
// label, plus enough extra to preview the first quest card's title/org
// line underneath (not the whole card, just enough to read "yes, there are
// real quests here"). Mirrors the fixed pixel value MobileSheet's own
// drag-snap math is built around.
const SHEET_PEEK_PX = 190;

// Continental-US center — only ever shown when geolocation is denied/
// unavailable AND no quest with coordinates exists to center on instead,
// so this is a last-resort fallback, not the common case.
const FALLBACK_CENTER = { lat: 39.8283, lng: -98.5795 };
const EARTH_RADIUS_KM = 6371;

// A fixed, hand-authored Location object rather than the component's own
// live `location` — every quest row/pin opens the SAME background (this
// page always lives at "/map"), and building the router-required
// backgroundLocation state from a plain constant sidesteps any stale-
// closure risk from capturing `useLocation()`'s value inside a marker click
// listener registered by an earlier effect run (see the markers effect
// below). See App.jsx's AppRoutes for how this state is actually consumed.
const MAP_BACKGROUND_LOCATION = { pathname: '/map', search: '', hash: '', state: null, key: 'map-bg' };

// Read imperatively at click time (not derived from any prop/state) — this
// component matches routes against the fixed MAP_BACKGROUND_LOCATION above,
// not the real browser location, so it never re-renders when the actual
// /map/:seriesId URL changes underneath the still-mounted overlay. The real
// window.location is the only place "is a detail already open" is visible
// from here.
function isMapDetailOpen() {
  return /^\/map\/[^/]+\/?$/.test(window.location.pathname);
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

// Sort options for the map's own Filters panel — "Nearest" only really
// means anything once a real position exists (see withDistance below);
// "Soonest" is the plain chronological fallback withDistance already used
// when no distance was available, now selectable on purpose instead of
// only ever being an automatic fallback.
const MAP_SORT_OPTIONS = [
  { value: 'nearest', label: 'Nearest' },
  { value: 'soonest', label: 'Soonest' },
];

// The map's own Filters panel content — just Sort, unlike Explore Quests'
// Type/Activity/Sort (see mobile/Quests.jsx's own FilterPanelContent):
// there's no side-quest/RSVP'd-quest equivalent here, every quest with
// real coordinates shows on the map the same way. Tags are searched via
// #token in the search bar instead (see VanishSearchInput/parseSearch),
// not a picker in this panel either — same reasoning as Explore Quests.
function MapFilterPanelContent({ sort, onSelectSort, activeFilterCount, onClearAll }) {
  return (
    <div className="quest-filter-panel">
      <div className="quest-filter-panel-header">
        <h2>Filters</h2>
        {activeFilterCount > 0 && (
          <button type="button" className="quest-filter-clear" onClick={onClearAll}>
            Clear all
          </button>
        )}
      </div>

      <div className="quest-filter-group quest-filter-group-inline">
        <p className="quest-filter-group-label">
          <IconList width={15} height={15} aria-hidden="true" />
          Sort
        </p>
        <div className="quest-filter-pill-row">
          {MAP_SORT_OPTIONS.map((opt) => (
            <FilterPill key={opt.value} selected={sort === opt.value} onClick={() => onSelectSort(opt.value)}>
              {opt.label}
            </FilterPill>
          ))}
        </div>
      </div>
    </div>
  );
}

// A draggable bottom sheet (mobile only) containing the quest list/detail —
// collapsed to a small peeking sliver while "exploring the map" (search +
// tag row floating above it are the focus then), or dragged/tapped open to
// browse the list in full (search/tags hide then — see EventsMap's own
// render). Opening a specific quest's detail (MapQuestOverlay.jsx, which
// portals into this same sheet's list-pane content) doesn't need any
// special-casing here: it's just whatever's currently inside `children`.
//
// Built on a plain framer-motion MotionValue + onPan/onPanEnd rather than
// the `drag` prop directly: `drag` fights with an `animate` target on the
// same value once a gesture ends, where this pattern — pan updates the
// value live, onPanEnd decides the final open/closed boolean, `animate`
// springs the rest of the way — is the standard way to get a clean snap.
// onPan/onPanEnd are only wired to the handle, not the whole sheet, so the
// list's own native scroll (once expanded) isn't hijacked by the same
// gesture.
function MobileSheet({ expanded, onExpandedChange, children }) {
  const reduce = useReducedMotion();
  const sheetRef = useRef(null);
  const y = useMotionValue(0);
  const [peekOffset, setPeekOffset] = useState(0);

  useEffect(() => {
    function measure() {
      if (sheetRef.current) setPeekOffset(Math.max(0, sheetRef.current.offsetHeight - SHEET_PEEK_PX));
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return (
    <motion.div
      ref={sheetRef}
      className="events-map-sheet"
      style={{ y }}
      animate={{ y: expanded ? 0 : peekOffset }}
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 34 }}
    >
      <motion.button
        type="button"
        className="events-map-sheet-handle"
        onPan={(e, info) => {
          const base = expanded ? 0 : peekOffset;
          y.set(Math.max(0, Math.min(peekOffset, base + info.offset.y)));
        }}
        onPanEnd={(e, info) => {
          const shouldExpand = info.velocity.y < -300 || y.get() < peekOffset / 2;
          onExpandedChange(shouldExpand);
        }}
        onClick={() => onExpandedChange(!expanded)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse quest list' : 'Expand quest list'}
      >
        <span className="events-map-sheet-handle-bar" aria-hidden="true" />
      </motion.button>
      {children}
    </motion.div>
  );
}

// A DoorDash-style "what's near me" view for quests, rather than the plain
// feed (Quests.jsx) — the two are deliberately separate screens: this one
// answers "where," the feed answers "what." Only quests with real
// coordinates show up here at all (see functions/main.py's
// _quest_doc_fields note) — side/default "anywhere" quests aren't tied to
// one point, so they're correctly absent, not a bug.
//
// Clicking a row or pin opens that quest's rich map detail at
// /map/:seriesId (MapQuestOverlay.jsx, floated over this same still-panned
// map via App.jsx's backgroundLocation routing) — this page itself no
// longer renders its own inline preview card, which used to live here.
export function EventsMap() {
  const { user, loading } = useAuth();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const hasFocusedFromParamRef = useRef(false);
  const [seriesList, setSeriesList] = useState(null);
  const [userPos, setUserPos] = useState(null);
  const [locationState, setLocationState] = useState('idle'); // idle | granted | denied | unavailable
  const [selectedSeriesId, setSelectedSeriesId] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [dataError, setDataError] = useState(null);
  const [search, setSearch] = useState('');
  // 'nearest' (default — the old always-on behavior) or 'soonest', picked
  // from the Filters panel below (see MapFilterPanelContent).
  const [sort, setSort] = useState('nearest');
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const filterWrapRef = useRef(null);
  const filterBtnRef = useRef(null);
  // Mobile only (see MobileSheet) — collapsed means "exploring the map"
  // (search/tags float over it instead), expanded means "browsing the
  // quest list/detail" (the sheet itself is the focus, search/tags hide).
  const [sheetExpanded, setSheetExpanded] = useState(false);

  const mapContainerRef = useRef(null);
  const mapObjRef = useRef(null);
  const markersRef = useRef(new Map());
  const userMarkerRef = useRef(null);
  const hasCenteredOnUserRef = useRef(false);
  const rowRefs = useRef(new Map());

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
    setDataError(null);
    Promise.all([
      getDocs(collection(db, 'quests')),
      getDocs(collection(db, 'questSeries')),
      getDocs(collection(db, 'organizations')),
    ])
      .then(([questsSnap, seriesSnap, orgsSnap]) => {
        // Filtered to upcoming occurrences BEFORE grouping, not after — a
        // recurring series' `primary` (groupBySeries' own earliest-occurrence
        // pick) is the *first ever* occurrence otherwise, which for a series
        // already in progress is a past date; isUpcoming(primary) would then
        // be false and drop the whole series from the map even though it has
        // later, still-upcoming dates. Filtering first means `primary` always
        // resolves to the soonest occurrence that's still upcoming — the one
        // date this page (and MapQuestOverlay/Page's own detail, see
        // useMapQuestSeries.js) actually wants to show, with no date picker
        // needed since nobody RSVPs from here (see mobile/Quests.jsx's own
        // load(), which filters the same way before grouping).
        const quests = questsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(isUpcoming);
        const seriesAgg = new Map(seriesSnap.docs.map((d) => [d.id, d.data()]));
        const logoByOrgId = new Map(orgsSnap.docs.map((d) => [d.id, d.data().logoUrl]));
        const groups = attachOrgLogos(
          attachSeriesRatings(groupBySeries(quests), seriesAgg),
          logoByOrgId,
        ).filter((g) => g.primary.lat != null && g.primary.lng != null);
        setSeriesList(groups);
      })
      .catch((err) => {
        // Without this, a failed read (permissions, network) left
        // seriesList stuck at null forever — an indefinite "Loading nearby
        // quests..." with nothing telling you it actually failed.
        setDataError(err.message || 'Could not load nearby quests.');
      });
  }, [user]);

  // Sorted nearest-first (falling back to soonest for anything without a
  // distance) by default — this is also what the "center on nearest
  // useful thing" effect further below assumes index 0 to be, so this
  // default sort stays applied here regardless of the Filters panel's own
  // `sort` state; visibleSeries re-sorts on top of this only for
  // 'soonest' (see below), leaving 'nearest' as this same order.
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

  // Tags/search narrow what's plotted and listed together — searching
  // "kitchen" should hide non-matching pins too, not just list rows, so the
  // map stays in sync with what's actually visible below it. Tags are
  // pulled out of the search text itself via a #token (see
  // VanishSearchInput/parseSearch, shared with mobile/Quests.jsx's own
  // #tag search) rather than a separate picker.
  const availableTags = useMemo(() => {
    const seen = new Set();
    withDistance.forEach((g) => (g.primary.tags || []).forEach((t) => seen.add(t)));
    return [...seen];
  }, [withDistance]);

  const { tags: searchTags, text: searchText } = useMemo(() => parseSearch(search), [search]);

  const activeFilterCount = (sort !== 'nearest' ? 1 : 0) + (searchTags.length > 0 ? 1 : 0);

  const visibleSeries = useMemo(() => {
    let list = withDistance;
    if (searchTags.length > 0) {
      list = list.filter((g) => (g.primary.tags || []).some((t) => searchTags.includes(t.toLowerCase())));
    }
    const q = searchText.toLowerCase();
    if (q) {
      list = list.filter((g) => {
        const { title, orgName, location } = g.primary;
        return [title, orgName, location].some((field) => (field || '').toLowerCase().includes(q));
      });
    }
    if (sort === 'soonest') {
      list = [...list].sort((a, b) => toDate(a.primary.eventDate) - toDate(b.primary.eventDate));
    }
    return list;
  }, [withDistance, searchTags, searchText, sort]);

  function clearAllFilters() {
    setSort('nearest');
    setSearch((prev) => parseSearch(prev).text);
  }

  // Closes the filter popover on an outside click or Escape — only wired
  // up on desktop; the mobile modal gets the same behavior for free from
  // LightboxBackdrop (backdrop tap / Escape). Same pattern as
  // mobile/Quests.jsx's own Filters button.
  useEffect(() => {
    if (!filterPanelOpen || !isDesktop) return undefined;
    function onPointerDown(e) {
      if (filterWrapRef.current && !filterWrapRef.current.contains(e.target)) {
        setFilterPanelOpen(false);
      }
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setFilterPanelOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [filterPanelOpen, isDesktop]);

  // Create the map exactly once, as soon as the container div exists — not
  // gated on quests/location being ready yet, so the map itself appears
  // immediately and markers just populate a moment later. Unlike the old
  // Google loader (an async script-injection dance), maplibre-gl is a
  // regular import — the constructor runs synchronously, so there's no
  // "wait for the library to load" step; we still wait for the map's own
  // 'load' event (its style/tiles finishing their first fetch) before
  // flipping mapReady, so markers aren't added before there's a map to
  // add them to.
  //
  // Depends on `loading`, not []: this component returns <LoadingSpinner/>
  // (no .events-map-container in the tree at all) for as long as useAuth()
  // is still resolving, and a []-deps effect only ever gets ONE chance to
  // run, tied to the very first commit — if that first commit happens to
  // be the loading-spinner render (a real race on a fresh login → navigate
  // flow, not just theoretical), mapContainerRef.current is null forever
  // after and the map silently never gets created. Re-running once loading
  // flips to false catches the container that actually exists by then;
  // the mapObjRef.current guard above still prevents creating it twice.
  useEffect(() => {
    if (!mapContainerRef.current || mapObjRef.current) return undefined;
    const map = new MapLibreMap({
      container: mapContainerRef.current,
      style: MAP_STYLE_URL,
      center: [FALLBACK_CENTER.lng, FALLBACK_CENTER.lat],
      zoom: 4,
    });
    // No NavigationControl (MapLibre's zoom +/- buttons) — pinch/scroll/
    // double-click zoom still all work, this just removes the on-screen
    // button pair. MapLibre has no "default UI" to disable the way Google
    // Maps did (disableDefaultUI:true); every control is opt-in, so this is
    // simply not opting in, not disabling anything.
    mapObjRef.current = map;
    map.on('load', () => setMapReady(true));
    map.on('error', (e) => {
      // Without this, a bad/missing MapTiler key or a blocked tile request
      // left mapReady false forever with zero indication why — just this
      // app's own plain --paper-well background sitting there silently.
      setMapError(e.error?.message || 'Could not load the map.');
    });
    return () => {
      map.remove();
      mapObjRef.current = null;
    };
  }, [loading]);

  function focusSeries(seriesId) {
    setSelectedSeriesId(seriesId);
    // A pin tap while the mobile sheet is still collapsed/peeking should
    // still bring its detail into view, same as tapping it from an already-
    // open list would — this is a no-op on desktop (no sheet there).
    setSheetExpanded(true);
    const g = visibleSeries.find((s) => s.seriesId === seriesId);
    if (g && mapObjRef.current) {
      // MapLibre (like most non-Google map libraries) takes coordinates as
      // [lng, lat] — the opposite order from Google's {lat, lng} object.
      // Easy to get backwards; every coordinate pair below is deliberately
      // written as [lng, lat] for that reason.
      //
      // One combined easeTo({center, zoom}), not separate panTo()+setZoom()
      // calls — panTo() is an *animated* transition, and calling setZoom()
      // on the very next line interrupts/cancels that in-flight animation
      // before it ever reaches the new center (setZoom itself is instant,
      // so it wins the race — zoom changes, but the pan silently never
      // completes). easeTo animates both center and zoom together as one
      // transition, so there's nothing to interrupt it.
      mapObjRef.current.easeTo({ center: [g.primary.lng, g.primary.lat], zoom: 14 });
    }
  }

  // Re-sync quest markers whenever the (already-sorted, already-filtered)
  // list changes. Cheap to just clear and rebuild at this app's scale — no
  // diffing. Each pin, clicked, opens the same rich map detail a list row
  // does (see the Link below) — highlight/pan happens immediately via
  // focusSeries, navigation happens right alongside it.
  useEffect(() => {
    if (!mapReady) return;
    // marker.remove() — MapLibre's teardown method, in place of Google's
    // marker.setMap(null).
    markersRef.current.forEach((marker) => {
      marker.remove();
    });
    markersRef.current = new Map();

    visibleSeries.forEach((g) => {
      const el = createQuestPinElement(g.primary.orgId || g.seriesId);
      // A plain HTML title attribute stands in for Google Marker's own
      // `title` (a native hover tooltip) — MapLibre's Marker has no
      // built-in equivalent option, but the underlying DOM element is ours
      // to set attributes on directly.
      el.title = g.primary.title;
      // Same destination a list row's own <Link> navigates to (see the
      // Link below) — clicking a pin now opens that quest's detail overlay
      // directly, not just pan+select. Clicking a second, different marker
      // while one detail is already open *replaces* that history entry
      // instead of pushing a new one on top — otherwise each marker→marker
      // click stacks another entry, and the overlay's own close button
      // (a single navigate(-1)) would have to unwind that whole stack one
      // quest at a time instead of going straight back to the list.
      el.addEventListener('click', () => {
        focusSeries(g.seriesId);
        navigate(`/map/${g.seriesId}`, {
          state: { backgroundLocation: MAP_BACKGROUND_LOCATION },
          replace: isMapDetailOpen(),
        });
      });
      // anchor: 'bottom' — the pin's pointed tip (not its visual center)
      // lands exactly on the coordinate, matching the old Google icon's
      // own bottom-center anchor point.
      const marker = new Marker({ element: el, anchor: 'bottom' })
        .setLngLat([g.primary.lng, g.primary.lat])
        .addTo(mapObjRef.current);
      markersRef.current.set(g.seriesId, marker);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, visibleSeries]);

  // Whichever pin/row is currently selected gets a visibly bigger icon (see
  // paintQuestPin's own `selected` param), and its list row scrolls into
  // view — covers "clicking a pin highlights + scrolls to the matching
  // card," the other direction (a row's own click) is already in view by
  // construction. Runs after the marker-rebuild effect above on the same
  // render, so it's always reapplying against the freshly built markers,
  // never a stale set.
  //
  // MapLibre's Marker has no marker.setIcon() the way Google's did — a
  // Marker keeps one DOM element for its whole life, so "selected" is a
  // style repaint on that same element (marker.getElement()) rather than
  // swapping in a new icon.
  useEffect(() => {
    markersRef.current.forEach((marker, seriesId) => {
      const g = visibleSeries.find((v) => v.seriesId === seriesId);
      if (!g) return;
      paintQuestPin(marker.getElement(), g.primary.orgId || g.seriesId, seriesId === selectedSeriesId);
    });
    // Skipped while a quest's detail overlay is open (isMapDetailOpen) —
    // the list row being scrolled to is completely covered by
    // MapQuestOverlay's portal at that point, so this had no visible
    // purpose, but scrollIntoView() still programmatically moved the
    // pane's real scrollTop regardless of its `overflow: hidden` (that
    // CSS only blocks *user*-driven scroll, not a script setting
    // scrollTop/calling scrollIntoView directly). Since the detail slot
    // is `position: absolute; inset: 0` *inside* that same pane, every
    // one of those scrolls dragged the open detail card up and out of
    // view along with it — worse with each successive marker click, since
    // scrollTop kept climbing to whichever row was clicked next.
    if (selectedSeriesId && !isMapDetailOpen()) {
      rowRefs.current.get(selectedSeriesId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedSeriesId, visibleSeries]);

  // The user's own position: a distinct marker, and the map recenters on
  // it exactly once (the first successful fix) — not every render, so a
  // later position update (there isn't one today, but if this ever moves
  // to watchPosition) wouldn't keep yanking the view back.
  useEffect(() => {
    if (!mapReady || !userPos) return;
    if (userMarkerRef.current) userMarkerRef.current.remove();
    // A plain filled circle element rather than a quest-pin-shaped
    // marker — "you" should read as visually distinct from "a quest is
    // here" at a glance.
    const el = createUserPositionElement();
    el.title = 'You are here';
    // No zIndex option on MapLibre's Marker (unlike Google's) — a marker
    // element is just an absolutely-positioned DOM node, so a plain CSS
    // z-index on it works the same way and keeps this one on top of quest
    // pins even after the marker-rebuild effect above re-runs later.
    el.style.zIndex = '999';
    userMarkerRef.current = new Marker({ element: el })
      .setLngLat([userPos.lng, userPos.lat])
      .addTo(mapObjRef.current);
    if (!hasCenteredOnUserRef.current) {
      mapObjRef.current.setCenter([userPos.lng, userPos.lat]);
      mapObjRef.current.setZoom(12);
      hasCenteredOnUserRef.current = true;
    }
  }, [mapReady, userPos]);

  // Absent a live position, center on the nearest thing to "somewhere
  // useful" once quests actually load — the first upcoming quest with
  // coordinates beats the continental-US default.
  //
  // Bug fixed here (pre-existing, not introduced by the MapLibre
  // migration — the old Google Maps version had the identical race):
  // hasCenteredOnUserRef only ever got set from the *real geolocation*
  // effect above, so without location permission granted, this effect
  // could fire again on any later change to `withDistance` (e.g. a
  // Firestore read settling a moment after mount) and silently override
  // wherever the org had just manually panned to by clicking a pin/row —
  // it looked like clicking a pin "did nothing" or centered on the wrong
  // quest. Marking the ref here too means *any* one-time initial
  // auto-center (real position or this fallback, whichever fires first)
  // permanently disables both — only an explicit focusSeries() pan moves
  // the view after that.
  useEffect(() => {
    if (!mapReady || hasCenteredOnUserRef.current || withDistance.length === 0) return;
    mapObjRef.current.setCenter([withDistance[0].primary.lng, withDistance[0].primary.lat]);
    mapObjRef.current.setZoom(11);
    hasCenteredOnUserRef.current = true;
  }, [mapReady, withDistance]);

  // The map/list swap from stacked to side-by-side (see .events-map-layout,
  // style.css) resizes the map's container without the window itself
  // resizing — the map doesn't notice that on its own and leaves tiles
  // laid out for the old size until nudged. MapLibre has this as a plain
  // method directly on the map instance — no event-trigger workaround
  // needed the way Google's API required.
  useEffect(() => {
    if (!mapReady) return;
    mapObjRef.current.resize();
  }, [mapReady, isDesktop]);

  // Deep-linked from a quest's location row (e.g. org/Quests.jsx's detail
  // pane, /map?seriesId=...) — focuses that quest's pin once the map's
  // ready and it's actually loaded, same as clicking its marker/list row
  // would. Ref-gated to fire once: visibleSeries changes on every
  // search/tag edit, and re-focusing on each of those would fight anyone
  // panning around after the initial jump.
  useEffect(() => {
    if (hasFocusedFromParamRef.current || !mapReady) return;
    const targetId = searchParams.get('seriesId');
    if (!targetId) return;
    if (!visibleSeries.some((g) => g.seriesId === targetId)) return;
    hasFocusedFromParamRef.current = true;
    focusSeries(targetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, visibleSeries, searchParams]);

  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  // What VanishSearchInput's placeholder cycles through — same pattern as
  // mobile/Quests.jsx's own search bar.
  const searchPlaceholders = [
    'Search',
    ...availableTags.slice(0, 4).map((tag) => `Try #${tag}`),
  ];

  // Built once and placed differently per breakpoint below, rather than
  // duplicated: mobile keeps them in normal document flow above the map
  // (unchanged); desktop moves the search into the sidebar card and floats
  // the location banner directly over the map instead (see App.jsx-style
  // breakpoint branching used throughout this codebase, e.g. mobile/
  // Quests.jsx's own desktop/mobile split). The old always-visible tag row
  // is gone — tags are searched via #token in the search bar now (same
  // VanishSearchInput/#tag pattern as Explore Quests), and Sort lives in
  // the Filters button's own panel (see MapFilterPanelContent) instead of
  // a separate control.
  const searchRow = (
    <div className="quest-search-row">
      <VanishSearchInput
        value={search}
        onChange={setSearch}
        placeholders={searchPlaceholders}
        ariaLabel="Search nearby quests"
      />
      <div className="quest-filter-wrap" ref={filterWrapRef}>
        <button
          ref={filterBtnRef}
          type="button"
          className="quest-filter-btn"
          aria-haspopup="dialog"
          aria-expanded={filterPanelOpen}
          aria-label={`Filters, ${activeFilterCount} active`}
          data-filters-active={activeFilterCount > 0 ? 'true' : undefined}
          onClick={() => setFilterPanelOpen((o) => !o)}
        >
          <IconFilter width={22} height={22} />
        </button>
        {filterPanelOpen && isDesktop && (
          <DesktopFilterPopover>
            <MapFilterPanelContent
              sort={sort}
              onSelectSort={setSort}
              activeFilterCount={activeFilterCount}
              onClearAll={clearAllFilters}
            />
          </DesktopFilterPopover>
        )}
      </div>
    </div>
  );

  const filterSheet = filterPanelOpen && !isDesktop && (
    <MobileFilterSheet onClose={() => setFilterPanelOpen(false)}>
      <MapFilterPanelContent
        sort={sort}
        onSelectSort={setSort}
        activeFilterCount={activeFilterCount}
        onClearAll={clearAllFilters}
      />
    </MobileFilterSheet>
  );

  const locationBanner = (locationState === 'denied' || locationState === 'unavailable') && (
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
  );

  const listContent = dataError ? (
    <p className="box-danger">{dataError}</p>
  ) : seriesList === null ? (
    <LoadingSpinner label="Loading nearby quests..." />
  ) : withDistance.length === 0 ? (
    <div className="quest-empty">
      <DuckMark size={96} />
      <h2>No Mappable Quests Yet</h2>
      <p>Once an organization posts a quest with a real address, it'll show up here.</p>
    </div>
  ) : visibleSeries.length === 0 ? (
    <p>No quests match that filter.</p>
  ) : (
    <div className="events-map-list">
      {visibleSeries.map((g) => {
        const isOpen = g.seriesId === selectedSeriesId;
        return (
          <div
            key={g.seriesId}
            className="ink-card events-map-list-row"
            data-active={isOpen ? 'true' : undefined}
            ref={(el) => {
              if (el) rowRefs.current.set(g.seriesId, el);
              else rowRefs.current.delete(g.seriesId);
            }}
          >
            <Link
              to={`/map/${g.seriesId}`}
              state={{ backgroundLocation: MAP_BACKGROUND_LOCATION }}
              className="events-map-list-row-head"
              onClick={(e) => {
                focusSeries(g.seriesId);
                // Same replace-instead-of-push guard as the pin click above,
                // for a plain click — a modifier/middle click (open in a new
                // tab) is left to the browser's own default <Link> handling,
                // since that's a fresh tab with its own history anyway.
                if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                  e.preventDefault();
                  navigate(`/map/${g.seriesId}`, {
                    state: { backgroundLocation: MAP_BACKGROUND_LOCATION },
                    replace: isMapDetailOpen(),
                  });
                }
              }}
            >
              <div className="quest-thumb">
                <OrgAvatar name={g.primary.orgName} seed={g.primary.orgId || g.seriesId} logoUrl={g.orgLogoUrl} />
              </div>
              <div className="events-map-list-meta">
                <p className="quest-title" style={{ margin: 0 }}>{g.primary.title}</p>
                <p className="quest-org-line">{g.primary.orgName}</p>
              </div>
              {g.distanceKm != null && <span className="events-map-list-distance">{formatDistance(g.distanceKm)}</span>}
            </Link>
          </div>
        );
      })}
    </div>
  );

  const hasListControls = seriesList !== null && withDistance.length > 0;

  return (
    <div className="events-map-page">
      <div className="events-map-layout">
        {/* Desktop: search + list share one continuous sidebar card on the
            left; the "Nearby" heading is dropped entirely (no room
            reserved for it in this full-bleed layout). */}
        {isDesktop && (
          <div className="events-map-sidebar">
            {hasListControls && searchRow}
            {/* id is MapQuestOverlay.jsx's portal target — its detail view
                renders straight into this node so opening a quest reads as
                a view switch in place of the list, not a modal floating on
                top of the page (see App.jsx's backgroundLocation routing). */}
            <div className="events-map-list-pane" id="events-map-list-pane">
              <div className="events-map-list-pane-inner">{listContent}</div>
            </div>
          </div>
        )}

        <div className="events-map-pane">
          <div className="events-map-container" ref={mapContainerRef}>
            {mapError && (
              <div className="events-map-error">
                <p className="box-danger">{mapError}</p>
              </div>
            )}
          </div>
          {/* Desktop only — floating over the map itself, like Google Maps'
              own category-shortcut row and any-warning banners; one
              wrapper so both stack vertically instead of overlapping when
              both show at once. Mobile's equivalent floats over the full-
              screen map directly, below, since there's no separate map pane
              to nest it inside there. */}
          {isDesktop && locationBanner && (
            <div className="events-map-overlays">
              {locationBanner}
            </div>
          )}
        </div>

        {/* Mobile: the map fills the whole screen behind everything else.
            The search bar + Filters button float over it, but only while
            "exploring the map" (the sheet below is still collapsed) —
            once it's dragged/tapped open to browse the list (or a
            quest's detail), these hide so the sheet itself is the focus,
            matching Google Maps' own mobile behavior. */}
        {!isDesktop && !sheetExpanded && (locationBanner || hasListControls) && (
          <div className="events-map-mobile-overlays">
            {locationBanner}
            {hasListControls && searchRow}
          </div>
        )}

        {!isDesktop && (
          <MobileSheet expanded={sheetExpanded} onExpandedChange={setSheetExpanded}>
            <div className="events-map-list-pane" id="events-map-list-pane">
              <div className="events-map-list-pane-inner">{listContent}</div>
            </div>
          </MobileSheet>
        )}
      </div>

      {filterSheet}
    </div>
  );
}
