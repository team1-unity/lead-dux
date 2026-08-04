import { useState } from 'react';
import { buildDirectionsUrl } from './mapLinks.js';
import { IconPin, IconCheck } from './icons.jsx';

// External Google Maps directions link for a quest's location (see
// mapLinks.js's buildDirectionsUrl). Clicking copies the location text to
// the clipboard first — a quick way to share it elsewhere — then, in the
// same click, still opens driving directions in a new tab; doesn't
// preventDefault, so the browser follows the link right after. Same
// copy-on-click reasoning as AddToCalendar.jsx/ShareButton (see
// QuestSeriesRow.jsx).
export function LocationLink({ location, lat, lng, className = 'quest-meta-row quest-meta-link' }) {
  const [copied, setCopied] = useState(false);

  if (!location) return null;

  async function handleClick() {
    await navigator.clipboard.writeText(location);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <a href={buildDirectionsUrl(lat, lng)} target="_blank" rel="noopener noreferrer" onClick={handleClick} className={className}>
      {copied ? <IconCheck /> : <IconPin />} {location}
    </a>
  );
}
