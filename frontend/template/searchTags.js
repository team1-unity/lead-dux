// Extracts #tag tokens from a search box (e.g. "#wellness volunteer" ->
// tags: ['wellness'], text: 'volunteer') — shared between mobile/Quests.jsx
// and EventsMap.jsx, both of which let someone search by tag straight from
// the search field (via VanishSearchInput's #-hinted placeholders) instead
// of a separate tag-picker UI. Multiple #tokens OR together wherever this
// is consumed.
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
