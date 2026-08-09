import { collection, getDocs } from 'firebase/firestore';

// A module-level cache (survives across component mounts, cleared only by
// invalidation below or a full page reload) for whole-collection reads that
// several independent screens each do on their own — quests/questSeries/
// organizations were each being re-fetched from scratch by every one of
// Home, Quests, EventsMap, Badges, and the admin Dashboard on every single
// mount, even when the last fetch was seconds old. Caching the in-flight
// *promise* rather than a resolved value also means two components mounting
// in the same tick (e.g. Quests.jsx and its own child components) share one
// network request instead of firing two.
//
// TTL, not "forever": these collections do change (a new quest, an RSVP),
// just rarely enough that a few seconds of staleness while bouncing between
// screens is an acceptable tradeoff — and callers that just mutated one of
// these collections explicitly invalidate it (see fetch.jsx's call* wrappers
// for create/update/delete quest, RSVP, and cancel RSVP) rather than waiting
// out the TTL.
const TTL_MS = 30_000;

const cache = new Map(); // name -> { promise, fetchedAt }

export function getCachedCollection(db, name) {
  const entry = cache.get(name);
  if (entry && Date.now() - entry.fetchedAt < TTL_MS) {
    return entry.promise;
  }
  const promise = getDocs(collection(db, name));
  cache.set(name, { promise, fetchedAt: Date.now() });
  // A failed fetch shouldn't poison the cache for the next, hopefully-
  // successful, attempt — without this, every caller within the TTL window
  // would just re-await the same already-rejected promise instead of
  // getting a chance to retry.
  promise.catch(() => cache.delete(name));
  return promise;
}

export function invalidateCachedCollection(name) {
  cache.delete(name);
}
