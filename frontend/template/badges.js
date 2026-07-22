import { TAG_TONES } from './tagTones.js';

// Badges have no backend of their own — no Firestore collection, no Cloud
// Function. Every badge here is derived entirely from quest docs a member
// has already RSVP'd to (the same 'quests' collection Quests.jsx reads),
// so "earned" always reflects real activity rather than a hardcoded demo
// state. Add a badge by adding an entry here; nothing else needs to change.

// One badge per interest tag (the same 9 tokens TagStamp/OrgAvatar use) —
// ties each badge's ring color to the actual tag it tracks, and gives the
// earned/in-progress/undiscovered lists enough real entries to fill out
// like a full badge case rather than just the handful of milestone ones.
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

export const BADGE_DEFS = [
  { id: 'first-quest', name: 'First Quest', description: "RSVP to your first quest", metric: 'rsvpCount', target: 1 },
  { id: 'high-five', name: 'High Five', description: 'RSVP to 5 quests', metric: 'rsvpCount', target: 5 },
  { id: 'regular', name: 'Regular', description: 'RSVP to 10 quests', metric: 'rsvpCount', target: 10 },
  { id: 'community-pillar', name: 'Community Pillar', description: 'RSVP to 20 quests', metric: 'rsvpCount', target: 20 },
  { id: 'side-quester', name: 'Side Quester', description: 'RSVP to a neighborhood side-quest', metric: 'sideQuestCount', target: 1 },
  { id: 'explorer', name: 'Explorer', description: 'RSVP to quests from 3 different organizations', metric: 'orgCount', target: 3 },
  ...TAG_TONES.map((tag) => ({
    id: `tag-${tag}`,
    name: TAG_LABELS[tag] || tag,
    description: `RSVP to 2 quests tagged "${tag}"`,
    metric: `tag:${tag}`,
    target: 2,
    tone: tag,
  })),
];

// `quests` is the raw (ungrouped, not-upcoming-filtered) quest doc list —
// badges count lifetime activity, not just what's currently browsable.
export function computeBadgeMetrics(quests, uid) {
  const mine = quests.filter((q) => (q.rsvpd || []).includes(uid));
  const orgIds = new Set(mine.filter((q) => q.orgId).map((q) => q.orgId));
  const metrics = {
    rsvpCount: mine.length,
    sideQuestCount: mine.filter((q) => q.isDefault).length,
    orgCount: orgIds.size,
  };
  for (const tag of TAG_TONES) {
    metrics[`tag:${tag}`] = mine.filter((q) => (q.tags || []).includes(tag)).length;
  }
  return metrics;
}

export function computeBadges(quests, uid) {
  const metrics = computeBadgeMetrics(quests, uid);
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
