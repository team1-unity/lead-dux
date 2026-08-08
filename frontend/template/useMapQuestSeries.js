import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebaseapp.jsx';
import { useAuth } from './AuthContext.jsx';
import { groupBySeries, attachSeriesRatings, isUpcoming, nextExplorableOccurrence } from './questSeries.js';

// Fetches one quest series by id for a signed-in map-detail view
// (MapQuestPage.jsx and MapQuestOverlay.jsx) — same independent-fetch shape
// frontend/app/src/QuestDetails.jsx already uses for the equivalent
// RSVP-focused page (a `where('seriesId', ...)` query, auth-only per
// firestore.rules) rather than relying on EventsMap's own in-memory list:
// the overlay and the map behind it are separate route matches, not
// parent/child, so there's no list to reuse anyway, and this stays correct
// on a hard refresh with the overlay still open.
//
// Also resolves the owning organization's own full profile doc, attached as
// `series.org` — MapQuestDetailBody's Overview/About tabs and hero carousel
// read logoUrl/phone/website/missionStatement/reason/city/state/
// contactEmail/socialLinks/ltag/etag/category/photos/avgRating/reviewCount
// straight off of it, same as OrganizationProfile.jsx does with its own
// `org` state — organizations/{uid} has no field that isn't already public
// to any signed-in reader (see firestore.rules), so there's nothing to pick
// and choose here.
export function useMapQuestSeries(seriesId) {
  const { user } = useAuth();
  const [series, setSeries] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    setSeries(null);
    setNotFound(false);
    setError(null);

    Promise.all([
      getDocs(query(collection(db, 'quests'), where('seriesId', '==', seriesId))),
      getDoc(doc(db, 'questSeries', seriesId)),
      // Same eventId set EventsMap.jsx's own list-loading effect builds —
      // this view's `primary` needs to agree with the list's own resolved
      // "next explorable date" for the same series, not fall back to
      // groupBySeries' plain earliest-upcoming pick regardless of whether
      // that date is already spoken for.
      getDocs(query(collection(db, 'attendance'), where('userId', '==', user.uid))),
    ])
      .then(([questsSnap, seriesAggSnap, attendanceSnap]) => {
        if (cancelled) return;
        // Filtered to upcoming occurrences before grouping — same reason
        // EventsMap.jsx's own list-loading effect does this (see its
        // comment): otherwise groupBySeries' `primary` (earliest occurrence
        // ever) could be a date long past for a series already in progress.
        // This view has no date picker (nobody RSVPs from the map, see
        // MapQuestDetailBody), so `primary` needs to already be the soonest
        // *explorable* upcoming date — one the viewer hasn't already RSVP'd
        // to or attended (see nextExplorableOccurrence) — not just the
        // series' earliest upcoming one regardless of that. A series with
        // nothing left to explore behaves the same as one that's been
        // deleted — there's nothing this view can usefully show either way.
        const quests = questsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(isUpcoming);
        if (quests.length === 0) {
          setNotFound(true);
          return;
        }
        const seriesDocsById = new Map([[seriesId, seriesAggSnap.exists() ? seriesAggSnap.data() : {}]]);
        const [rated] = attachSeriesRatings(groupBySeries(quests), seriesDocsById);
        const attendedEventIds = new Set(attendanceSnap.docs.map((d) => d.data().eventId));
        const primary = nextExplorableOccurrence(rated, user.uid, attendedEventIds);
        if (!primary) {
          setNotFound(true);
          return;
        }
        const grouped = { ...rated, primary };
        const orgId = grouped.primary.orgId;
        if (!orgId) {
          setSeries({ ...grouped, org: null });
          return;
        }
        getDoc(doc(db, 'organizations', orgId))
          .then((orgSnap) => {
            if (cancelled) return;
            setSeries({ ...grouped, org: orgSnap.exists() ? orgSnap.data() : null });
          })
          .catch((err) => {
            if (!cancelled) setError(err.message || 'Could not load this organization.');
          });
      })
      .catch((err) => {
        // Without this, a failed/denied read left `series` stuck at null
        // forever — MapQuestOverlay/MapQuestPage would just show their
        // loading spinner indefinitely with no visible sign anything went
        // wrong, since neither the network layer nor the console
        // necessarily surfaces a Firestore rejection loudly.
        if (!cancelled) setError(err.message || 'Could not load this quest.');
      });

    return () => {
      cancelled = true;
    };
  }, [seriesId, user]);

  return { series, notFound, error };
}
