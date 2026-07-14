// Groups a flat list of quest docs into one entry per series. Every quest
// has a seriesId, even a standalone one-off (it's just its own doc id —
// see functions/main.py's module note above _generate_series_dates), so
// grouping by seriesId naturally handles both cases with no special case
// for "this one isn't part of a series."
function toDate(value) {
  return value.toDate ? value.toDate() : new Date(value);
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

const FREQUENCY_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

export function formatRecurrence(quest) {
  if (!quest.recurrenceFrequency) return null;
  const until = toDate(quest.recurrenceUntil);
  return `${FREQUENCY_LABELS[quest.recurrenceFrequency] || quest.recurrenceFrequency} until ${until.toLocaleDateString()}`;
}
