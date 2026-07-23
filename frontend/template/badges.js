import { TAG_TONES } from './tagTones.js';
import { toDate } from './questSeries.js';

// Badges have no backend of their own beyond mark_badges_seen (see
// fetch.jsx) — every badge here is derived entirely from the caller's own
// `attendance` docs (functions/main.py's check_in_to_event writes one per
// actually-checked-in quest) plus their user doc's rank/createdAt, so
// "earned" reflects real completed activity, not just an RSVP that was
// never followed through on. Add a badge by adding an entry here; nothing
// else needs to change.

const TAG_LABELS = {
  community: 'Community Builder',
  education: 'Educator',
  environment: 'Environmentalist',
  outdoors: 'Trailblazer',
  technology: 'Technologist',
  youth: 'Youth Mentor',
  fitness: 'Fit & Active',
  'food-security': 'Food Security Ally',
  arts: 'Creative Spirit',
};

// A day count, not a rank name — "how fast," not "how far." 14 days from
// account creation to first reaching Bronze+ is generous enough to be
// achievable in a normal first couple of weeks, not just for someone who
// happened to join right before a packed weekend.
const RISING_FAST_WINDOW_DAYS = 14;

export const BADGE_DEFS = [
  { id: 'first-quest', name: 'First Quest', description: 'Complete your first quest', metric: 'completedCount', target: 1 },
  { id: 'high-five', name: 'High Five', description: 'Complete 5 quests', metric: 'completedCount', target: 5 },
  { id: 'regular', name: 'Regular', description: 'Complete 10 quests', metric: 'completedCount', target: 10 },
  { id: 'community-pillar', name: 'Community Pillar', description: 'Complete 20 quests', metric: 'completedCount', target: 20 },
  { id: 'quest-warrior', name: 'Quest Warrior', description: 'Complete 25 quests', metric: 'completedCount', target: 25 },
  { id: 'side-quester', name: 'Side Quester', description: 'Complete a neighborhood side-quest', metric: 'sideQuestCount', target: 1 },
  { id: 'explorer', name: 'Explorer', description: 'Complete quests from 3 different organizations', metric: 'orgCount', target: 3 },
  {
    id: 'rising-fast',
    name: 'Rising Fast',
    description: `Reach Bronze rank within ${RISING_FAST_WINDOW_DAYS} days of joining`,
    metric: 'risingFast',
    target: 1,
  },
  ...TAG_TONES.map((tag) => ({
    id: `tag-${tag}`,
    name: TAG_LABELS[tag] || tag,
    description: `Complete 2 quests tagged "${tag}"`,
    metric: `tag:${tag}`,
    target: 2,
    tone: tag,
  })),
];

// `attendance` is the caller's own attendance docs (where userId == uid),
// `questsById` a Map of every quest doc id to its data (for isDefault/tags/
// orgId lookups — attendance docs themselves don't carry those). `rank`/
// `createdAt` come straight off the user doc.
export function computeBadgeMetrics({ attendance, questsById, rank, createdAt }) {
  const completed = attendance
    .map((a) => questsById.get(a.eventId))
    .filter(Boolean);
  const orgIds = new Set(completed.filter((q) => q.orgId).map((q) => q.orgId));

  const daysSinceJoined = createdAt ? (Date.now() - toDate(createdAt).getTime()) / 86_400_000 : Infinity;
  const risingFast = rank && rank !== 'Iron' && daysSinceJoined <= RISING_FAST_WINDOW_DAYS ? 1 : 0;

  const metrics = {
    completedCount: completed.length,
    sideQuestCount: completed.filter((q) => q.isDefault).length,
    orgCount: orgIds.size,
    risingFast,
  };
  for (const tag of TAG_TONES) {
    metrics[`tag:${tag}`] = completed.filter((q) => (q.tags || []).includes(tag)).length;
  }
  return metrics;
}

export function computeBadges(input) {
  const metrics = computeBadgeMetrics(input);
  return BADGE_DEFS.map((def) => {
    const progress = metrics[def.metric] || 0;
    return {
      ...def,
      progress,
      earned: progress >= def.target,
      started: progress > 0,
    };
  });
}

// ---------- "seen" tracking (localStorage cache + DB source of truth) ----------
//
// localStorage alone would forget on a new device/browser; the DB field
// alone would mean a flash of "not new" before Firestore answers. Check
// localStorage first for instant paint, then reconcile with whatever the
// user doc actually has once it loads (see Badges.jsx).
const SEEN_STORAGE_KEY = 'lq-badges-seen';

export function getLocallySeenBadgeIds() {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function markBadgesSeenLocally(ids) {
  const seen = new Set(getLocallySeenBadgeIds());
  ids.forEach((id) => seen.add(id));
  try {
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // localStorage unavailable — falls back to whatever the DB already
    // has next load, same harmless degradation as theme.js.
  }
}
