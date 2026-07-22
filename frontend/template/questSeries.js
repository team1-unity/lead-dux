// Groups a flat list of quest docs into one entry per series. Every quest
// has a seriesId, even a standalone one-off (it's just its own doc id —
// see functions/main.py's module note above _generate_series_dates), so
// grouping by seriesId naturally handles both cases with no special case
// for "this one isn't part of a series."
export function toDate(value) {
  return value.toDate ? value.toDate() : new Date(value);
}

// Mirrors functions/main.py's DEFAULT_EVENT_WINDOW_HOURS — used when a
// quest has no explicit eventEndTime, to compute when it should stop being
// treated as "still happening" for browsing/filtering purposes.
export const DEFAULT_EVENT_WINDOW_HOURS = 6;

// A quest is still "upcoming" until its own end window has passed — the
// same effective end functions/main.py uses to compute QR/attendance
// expiry (eventEndTime, or eventDate + the default window when no end time
// was set). Past occurrences are hidden from browsing lists rather than
// deleted, so RSVP history/reviews/attendance for them are still reachable
// by anyone who already has the link, just not front-and-center for browsing.
export function isUpcoming(quest) {
  if (!quest.eventDate) return true;
  const end = quest.eventEndTime
    ? toDate(quest.eventEndTime)
    : new Date(toDate(quest.eventDate).getTime() + DEFAULT_EVENT_WINDOW_HOURS * 60 * 60 * 1000);
  return end.getTime() >= Date.now();
}

// `primary` (the earliest occurrence) carries the fields that are
// identical across every occurrence in a series by construction — title,
// description, tags, location, timezone, orgName, recurrenceFrequency/
// Until. Anything occurrence-specific (RSVPs, capacity remaining,
// attendance) still has to be read from whichever occurrence is actually
// selected, not from `primary`. Reviews are the one exception — they live
// at the series level (see attachSeriesRatings), not per occurrence, so
// they're the same no matter which date is selected.
export function groupBySeries(quests) {
  const bySeriesId = new Map();
  quests.forEach((quest) => {
    const key = quest.seriesId || quest.id;
    if (!bySeriesId.has(key)) bySeriesId.set(key, []);
    bySeriesId.get(key).push(quest);
  });

  return [...bySeriesId.values()].map((occurrences) => {
    const sorted = [...occurrences].sort((a, b) => toDate(a.eventDate) - toDate(b.eventDate));
    return { seriesId: sorted[0].seriesId || sorted[0].id, occurrences: sorted, primary: sorted[0] };
  });
}

// Merges questSeries/{seriesId} aggregate docs (avgRating/reviewCount —
// see submit_review in functions/main.py) onto each series group. Series
// with no reviews yet have no questSeries doc at all, hence the fallbacks.
export function attachSeriesRatings(groups, seriesDocsById) {
  return groups.map((group) => {
    const agg = seriesDocsById.get(group.seriesId);
    return { ...group, avgRating: agg?.avgRating ?? null, reviewCount: agg?.reviewCount ?? 0 };
  });
}

// Merges each series' owning organization's trust tag (see
// callListOrganizationTrustTags/list_organization_trust_tags) onto the
// group — distinct from attachSeriesRatings above, which is this one
// event's own star rating. Default/neighborhood quests (no orgId), and any
// org the trust-tags list doesn't know about yet, both come back null — no
// tag renders either way (see TrustTag.jsx).
export function attachOrgTrustStatus(groups, trustStatusByOrgId) {
  return groups.map((group) => ({
    ...group,
    orgTrustStatus: (group.primary.orgId && trustStatusByOrgId.get(group.primary.orgId)) || null,
  }));
}

// Mirrors functions/main.py's TRUST_SCORE_MIN_REVIEWS/TRUST_SCORE_TAG_THRESHOLD/
// TRUST_SCORE_FLAG_THRESHOLD/_trust_status — only needed where a raw
// avgRating/reviewCount is read directly off an organizations/{uid} doc (an
// org viewing its own dashboard, which can already see its own true numbers
// per firestore.rules) instead of through list_organization_trust_tags,
// which runs this same check server-side and never sends the raw numbers
// at all. Returns 'new' | 'trustworthy' | 'under_review' | null, same as
// the server.
const TRUST_SCORE_MIN_REVIEWS = 3;
const TRUST_SCORE_TAG_THRESHOLD = 80;
const TRUST_SCORE_FLAG_THRESHOLD = 60;

export function getTrustStatus(reviewCount, avgRating) {
  if (reviewCount < TRUST_SCORE_MIN_REVIEWS) return 'new';
  const score = Math.round((avgRating / 5) * 100);
  if (score >= TRUST_SCORE_TAG_THRESHOLD) return 'trustworthy';
  if (score <= TRUST_SCORE_FLAG_THRESHOLD) return 'under_review';
  return null;
}

const FREQUENCY_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

export function formatRecurrence(quest) {
  if (!quest.recurrenceFrequency) return null;
  const until = toDate(quest.recurrenceUntil);
  return `${FREQUENCY_LABELS[quest.recurrenceFrequency] || quest.recurrenceFrequency} until ${until.toLocaleDateString()}`;
}
