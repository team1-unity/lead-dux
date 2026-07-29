import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebaseapp.jsx';
import { useAuth } from './AuthContext.jsx';
import { groupBySeries, attachSeriesRatings, attachOrgLogos, isUpcoming, toDate } from './questSeries.js';
import { loadMapsLibrary, loadMarkerLibrary } from './googleMaps.js';
import { MAP_STYLE, questPinIcon } from './mapStyle.js';
import { useIsDesktop } from './useIsDesktop.js';
import { LoadingSpinner } from './LoadingSpinner.jsx';
import { StampButton } from './StampButton.jsx';
import { OrgAvatar } from './OrgAvatar.jsx';
import { TagStamp } from './TagStamp.jsx';
import { DuckMark } from './Logo.jsx';
import { IconSearch, IconChevron } from './icons.jsx';

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

// Wraps .tag-filter-row with a scroll-by-one-tap arrow at whichever edge
// still has more content past it (Google Maps' own category-shortcut row
// does the same on desktop) — hidden entirely once there's nothing further
// that way, so it never shows a dead-end arrow. A plain scroll-position
// check rather than IntersectionObserver-per-chip: this row is small (a
// dozen tags at most), so re-measuring the whole container on every
// scroll/resize is cheap.
//
// `arrows` is off on mobile — a touch swipe is already the natural way to
// scroll this row there, and a pair of tap targets floating over it would
// just be redundant chrome competing with the pills themselves.
function ScrollableTagRow({ children, arrows = true }) {
  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  function updateScrollState() {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  useEffect(() => {
    if (!arrows) return undefined;
    updateScrollState();
    const el = scrollRef.current;
    if (!el) return undefined;
    el.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', updateScrollState);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children, arrows]);

  if (!arrows) {
    return <div className="tag-filter-row">{children}</div>;
  }

  return (
    <div className="tag-filter-row-wrap">
      <div className="tag-filter-row" ref={scrollRef}>
        {children}
      </div>
      {canScrollLeft && (
        <button
          type="button"
          className="tag-filter-row-arrow tag-filter-row-arrow-left"
          onClick={() => scrollRef.current?.scrollBy({ left: -220, behavior: 'smooth' })}
          aria-label="Scroll tags left"
        >
          <IconChevron style={{ transform: 'rotate(90deg)' }} />
        </button>
      )}
      {canScrollRight && (
        <button
          type="button"
          className="tag-filter-row-arrow tag-filter-row-arrow-right"
          onClick={() => scrollRef.current?.scrollBy({ left: 220, behavior: 'smooth' })}
          aria-label="Scroll tags right"
        >
          <IconChevron style={{ transform: 'rotate(-90deg)' }} />
        </button>
      )}
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
  const [activeTag, setActiveTag] = useState(null);
  // Mobile only (see MobileSheet) — collapsed means "exploring the map"
  // (search/tags float over it instead), expanded means "browsing the
  // quest list/detail" (the sheet itself is the focus, search/tags hide).
  const [sheetExpanded, setSheetExpanded] = useState(false);

  const mapContainerRef = useRef(null);
  const mapObjRef = useRef(null);
  const markerCtorRef = useRef(null);
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
  // map stays in sync with what's actually visible below it.
  const availableTags = useMemo(() => {
    const seen = new Set();
    withDistance.forEach((g) => (g.primary.tags || []).forEach((t) => seen.add(t)));
    return [...seen];
  }, [withDistance]);

  const visibleSeries = useMemo(() => {
    let list = withDistance;
    if (activeTag) list = list.filter((g) => (g.primary.tags || []).includes(activeTag));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((g) => {
        const { title, orgName, location } = g.primary;
        return [title, orgName, location].some((field) => (field || '').toLowerCase().includes(q));
      });
    }
    return list;
  }, [withDistance, activeTag, search]);

  // Create the map exactly once, as soon as the container div exists — not
  // gated on quests/location being ready yet, so the map itself appears
  // immediately and markers just populate a moment later.
  useEffect(() => {
    if (!mapContainerRef.current || mapObjRef.current) return;
    let cancelled = false;
    Promise.all([loadMapsLibrary(), loadMarkerLibrary()])
      .then(([{ Map }, { Marker }]) => {
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
      })
      .catch((err) => {
        // Without this, a rejected loadMapsLibrary/loadMarkerLibrary (bad or
        // missing API key, quota, a blocked script) left mapReady false
        // forever with zero indication why — just this app's own plain
        // --paper-well background sitting there silently, since Google's own
        // usual on-map error overlay never has a map to attach to yet.
        if (!cancelled) setMapError(err.message || 'Could not load the map.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function focusSeries(seriesId) {
    setSelectedSeriesId(seriesId);
    // A pin tap while the mobile sheet is still collapsed/peeking should
    // still bring its detail into view, same as tapping it from an already-
    // open list would — this is a no-op on desktop (no sheet there).
    setSheetExpanded(true);
    const g = visibleSeries.find((s) => s.seriesId === seriesId);
    if (g && mapObjRef.current) {
      mapObjRef.current.panTo({ lat: g.primary.lat, lng: g.primary.lng });
      mapObjRef.current.setZoom(14);
    }
  }

  // Re-sync quest markers whenever the (already-sorted, already-filtered)
  // list changes. Cheap to just clear and rebuild at this app's scale — no
  // diffing. Each pin, clicked, opens the same rich map detail a list row
  // does (see the Link below) — highlight/pan happens immediately via
  // focusSeries, navigation happens right alongside it.
  useEffect(() => {
    if (!mapReady) return;
    markersRef.current.forEach((marker) => {
      marker.setMap(null);
    });
    markersRef.current = new Map();

    visibleSeries.forEach((g) => {
      const marker = new markerCtorRef.current({
        map: mapObjRef.current,
        position: { lat: g.primary.lat, lng: g.primary.lng },
        title: g.primary.title,
        icon: questPinIcon(g.primary.orgId || g.seriesId),
      });
      marker.addListener('click', () => focusSeries(g.seriesId));
      markersRef.current.set(g.seriesId, marker);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, visibleSeries]);

  // Whichever pin/row is currently selected gets a visibly bigger icon (see
  // questPinIcon's own `selected` param), and its list row scrolls into
  // view — covers "clicking a pin highlights + scrolls to the matching
  // card," the other direction (a row's own click) is already in view by
  // construction. Runs after the marker-rebuild effect above on the same
  // render, so it's always reapplying against the freshly built markers,
  // never a stale set.
  useEffect(() => {
    markersRef.current.forEach((marker, seriesId) => {
      const g = visibleSeries.find((v) => v.seriesId === seriesId);
      if (!g) return;
      marker.setIcon(questPinIcon(g.primary.orgId || g.seriesId, seriesId === selectedSeriesId));
    });
    if (selectedSeriesId) {
      rowRefs.current.get(selectedSeriesId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedSeriesId, visibleSeries]);

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

  // The map/list swap from stacked to side-by-side (see .events-map-layout,
  // style.css) resizes the map's container without the window itself
  // resizing — Google Maps doesn't notice that on its own and leaves tiles
  // laid out for the old size until nudged.
  useEffect(() => {
    if (!mapReady) return;
    window.google.maps.event.trigger(mapObjRef.current, 'resize');
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

  // Built once and placed differently per breakpoint below, rather than
  // duplicated: mobile keeps them in normal document flow above the map
  // (unchanged); desktop moves the search into the sidebar card and floats
  // the tag row + location banner directly over the map instead (see
  // App.jsx-style breakpoint branching used throughout this codebase, e.g.
  // mobile/Quests.jsx's own desktop/mobile split).
  const searchField = (
    <div className="search-field">
      <IconSearch />
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search"
        aria-label="Search nearby quests"
      />
    </div>
  );

  const tagFilterRow = availableTags.length > 0 && (
    <ScrollableTagRow arrows={isDesktop}>
      <TagStamp selectable selected={activeTag === null} onClick={() => setActiveTag(null)}>
        All
      </TagStamp>
      {availableTags.map((tag) => (
        <TagStamp key={tag} tone={tag} selectable selected={activeTag === tag} onClick={() => setActiveTag(tag)}>
          {tag}
        </TagStamp>
      ))}
    </ScrollableTagRow>
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
              onClick={() => focusSeries(g.seriesId)}
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
            {hasListControls && <div className="events-map-search-row">{searchField}</div>}
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
          {isDesktop && (locationBanner || tagFilterRow) && (
            <div className="events-map-overlays">
              {locationBanner}
              {tagFilterRow}
            </div>
          )}
        </div>

        {/* Mobile: the map fills the whole screen behind everything else.
            Search + tags float over it, but only while "exploring the
            map" (the sheet below is still collapsed) — once it's dragged/
            tapped open to browse the list (or a quest's detail), these
            hide so the sheet itself is the focus, matching Google Maps'
            own mobile behavior. */}
        {!isDesktop && !sheetExpanded && (locationBanner || hasListControls) && (
          <div className="events-map-mobile-overlays">
            {locationBanner}
            {hasListControls && searchField}
            {tagFilterRow}
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
    </div>
  );
}
