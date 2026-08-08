// Shared by every quest-browsing search field that supports #tag tokens
// (mobile/Quests.jsx, EventsMap.jsx) — a #token (e.g. "#wellness volunteer")
// pulls tag(s) out of the raw search text; whatever's left over is still
// matched against title/orgName/location the same as a plain search.
// Multiple #tokens OR together.
export function parseSearch(raw) {
  const tags = [];
  const text = raw
    .replace(/#([a-z0-9-]+)/gi, (_match, tag) => {
      tags.push(tag.toLowerCase());
      return '';
    })
    .trim();
  return { tags, text };
}
