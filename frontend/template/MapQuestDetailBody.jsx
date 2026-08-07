import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StampButton } from './StampButton.jsx';
import { ShareButton } from './QuestSeriesRow.jsx';
import { HeroCarousel } from './HeroCarousel.jsx';
import { QuestReviewsList } from './QuestReviewsList.jsx';
import { useIsDesktop } from './useIsDesktop.js';
import { toDate } from './questSeries.js';
import { LocationLink } from './LocationLink.jsx';
import {
  IconPin,
  IconCalendar,
  IconPhone,
  IconGlobe,
  IconMail,
  IconInstagram,
  IconFacebook,
  IconX,
  IconChevron,
  IconLinkedIn,
  IconTikTok,
  IconYouTube,
} from './icons.jsx';

const SOCIAL_ICONS = {
  instagram: IconInstagram,
  facebook: IconFacebook,
  twitter: IconX,
  linkedin: IconLinkedIn,
  tiktok: IconTikTok,
  youtube: IconYouTube,
};

function formatEventDate(value) {
  if (!value) return null;
  return toDate(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatStars(rating) {
  const whole = Math.round(rating);
  return '★'.repeat(whole) + '☆'.repeat(5 - whole);
}

// Everything from the org's own "About" profile section apart from the
// quest's own location (that's the Overview tab's own map-link) — whatever
// fields the org actually filled in, same rendering (and field order)
// OrganizationProfile.jsx's own About section already uses, phone/website
// included. Deliberately skips every tag/chip OrganizationProfile.jsx shows
// (category, ltag/etag location/activity tags) — text and contact info
// only here. `org` is the full organizations/{uid} doc (see
// useMapQuestSeries.js) — every field here is optional and just doesn't
// render when absent.
function AboutTab({ org }) {
  if (!org) return <p className="field-optional">Nothing to show yet.</p>;
  const socialEntries = Object.entries(org.socialLinks || {}).filter(([, url]) => url);

  return (
    <div>
      {org.missionStatement && <p style={{ margin: '0 0 10px' }}>{org.missionStatement}</p>}
      {(org.city || org.state) && (
        <p className="data-stat">
          <IconPin /> {[org.city, org.state].filter(Boolean).join(', ')}
        </p>
      )}
      {org.website && (
        <p className="data-stat">
          <IconGlobe /> <a href={org.website} target="_blank" rel="noreferrer">{org.website}</a>
        </p>
      )}
      {org.contactEmail && (
        <p className="data-stat">
          <IconMail /> <a href={`mailto:${org.contactEmail}`}>{org.contactEmail}</a>
        </p>
      )}
      {org.phone && (
        <p className="data-stat">
          <IconPhone /> {org.phone}
        </p>
      )}
      {socialEntries.length > 0 && (
        <div className="org-social-links">
          {socialEntries.map(([key, url]) => {
            const Icon = SOCIAL_ICONS[key];
            if (!Icon) return null;
            return (
              <a key={key} href={url} target="_blank" rel="noreferrer" aria-label={key}>
                <Icon />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// The Google-Maps-place-page-inspired body shared by the two ways a
// signed-in member reaches a quest's map detail: the overlay view opened
// from EventsMap's list rows/pins (MapQuestOverlay.jsx), and the standalone
// full-page fallback for a direct load or refresh (MapQuestPage.jsx).
// `fullDetailsHref` points at the full RSVP-capable page (/quests/:seriesId)
// — this body has no RSVP action of its own, just a way to reach one.
// The location row IS the Directions action (opens Google's own directions
// URL — see buildDirectionsUrl), rather than a separate button; Share
// reuses ShareButton's existing icon-only mode, which already points at
// this same quest's one /share/:seriesId link — one shareable link per
// quest, not a second map-flavored one. Location/date sit above the tabs
// (not inside Overview) — they're true regardless of which tab is open, so
// they stay put across all three instead of disappearing when Reviews/About
// is selected.
//
// `onClose` (optional) is only ever passed by MapQuestOverlay.jsx —
// MapQuestPage.jsx (a full standalone page, not an overlay) has nothing to
// close. Desktop gets a themed "Back to Map" link (the same .back-link
// treatment used everywhere else in the app) sitting above the hero,
// rather than a bare X floating on the photo — this isn't a lightbox
// someone is dismissing, it's a real navigation back to the map, so it
// reads as one. Mobile keeps its own back-chevron floating in the hero's
// top-left corner instead (returning to the sheet's list beneath it) —
// this is the one place in the component that branches on breakpoint.
//
// `series.org` (see useMapQuestSeries.js) is the owning organization's full
// profile doc — optional, and every field read off it below just doesn't
// render when absent.
export function MapQuestDetailBody({ series, fullDetailsHref, onClose }) {
  const isDesktop = useIsDesktop();
  const { primary, org } = series;
  const [tab, setTab] = useState('overview');
  const hasReviews = series.reviewCount > 0;

  return (
    <div className="map-quest-detail-body">
      {onClose && isDesktop && (
        <button type="button" className="back-link map-quest-back-link" onClick={onClose}>
          <IconChevron style={{ transform: 'rotate(90deg)' }} />
          Back to Map
        </button>
      )}
      <div className="quest-hero">
        <HeroCarousel photoPaths={org?.photos} orgLogoUrl={org?.logoUrl} />
        {onClose && !isDesktop && (
          <button type="button" className="map-quest-hero-back" onClick={onClose} aria-label="Back to map">
            <IconChevron style={{ transform: 'rotate(90deg)' }} width={20} height={20} />
          </button>
        )}
      </div>

      <p className="quest-title" style={{ fontSize: '1.3rem', margin: '14px 0 2px' }}>
        {primary.title}
      </p>
      {series.reviewCount > 0 && (
        <p className="quest-meta-row">
          {formatStars(series.avgRating)}{' '}
          <span className="field-optional">
            ({series.reviewCount} review{series.reviewCount === 1 ? '' : 's'})
          </span>
        </p>
      )}
      {/* Trust tag (Trustworthy/New Organization/Under Review) only shows
          on the org's own profile page (OrganizationProfile.jsx) now, not
          here. */}
      {primary.orgName && (
        <div className="flex items-center gap-sm" style={{ marginTop: 4, flexWrap: 'wrap' }}>
          {primary.orgId ? (
            <Link to={`/organizations/${primary.orgId}`} className="quest-org-line">
              {primary.orgName}
            </Link>
          ) : (
            <span className="quest-org-line">{primary.orgName}</span>
          )}
        </div>
      )}

      <div className="map-quest-info-block" style={{ marginTop: 10 }}>
        <LocationLink location={primary.location} lat={primary.lat} lng={primary.lng} />
        {formatEventDate(primary.eventDate) && (
          // Always the soonest *upcoming* date, not a recurrence-pattern
          // summary — useMapQuestSeries.js/EventsMap.jsx both filter a
          // series' occurrences to upcoming ones before picking `primary`,
          // specifically so this reads as "when's it next happening,"
          // matching why nobody needs a date picker on the map (see those
          // files' own notes).
          <p className="quest-meta-row">
            <IconCalendar /> {formatEventDate(primary.eventDate)}
          </p>
        )}
      </div>

      <div className="map-quest-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'overview'} data-active={tab === 'overview'} onClick={() => setTab('overview')}>
          Overview
        </button>
        {hasReviews && (
          <button type="button" role="tab" aria-selected={tab === 'reviews'} data-active={tab === 'reviews'} onClick={() => setTab('reviews')}>
            Reviews
          </button>
        )}
        <button type="button" role="tab" aria-selected={tab === 'about'} data-active={tab === 'about'} onClick={() => setTab('about')}>
          About
        </button>
      </div>

      {tab === 'overview' && primary.description && <p className="quest-description">{primary.description}</p>}

      {tab === 'reviews' && hasReviews && (
        <QuestReviewsList questId={primary.id} reviewCount={series.reviewCount} />
      )}

      {tab === 'about' && <AboutTab org={org} />}

      <div className="flex items-center gap-sm" style={{ marginTop: 12 }}>
        <StampButton as={Link} to={fullDetailsHref} variant="primary">
          View full quest details
        </StampButton>
        <ShareButton seriesId={series.seriesId} questTitle={primary.title} iconOnly />
      </div>
    </div>
  );
}
