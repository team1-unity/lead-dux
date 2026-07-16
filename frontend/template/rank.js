// Leadership rank ladder — 100 points per rank (see AI_README.md's "Point
// System & Feedback" section). Purely a display computation: `points` is
// the only thing actually stored (users/{uid}.points); rank is derived
// from it fresh every time, here and nowhere else, so there's exactly one
// place to update if the thresholds ever change. Side-quest tiers share
// these same names but aren't wired up to rank-gated unlocking yet.
const RANKS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Diamond'];
const POINTS_PER_RANK = 100;

function rankIndex(points) {
  return Math.min(Math.floor(Math.max(points, 0) / POINTS_PER_RANK), RANKS.length - 1);
}

export function rankForPoints(points) {
  return RANKS[rankIndex(points)];
}

// Points remaining until the next rank, or null if already at the top
// (Diamond) rank.
export function pointsToNextRank(points) {
  const index = rankIndex(points);
  if (index === RANKS.length - 1) return null;
  return (index + 1) * POINTS_PER_RANK - Math.max(points, 0);
}
