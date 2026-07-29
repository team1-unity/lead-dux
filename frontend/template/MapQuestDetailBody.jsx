import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { storage } from './firebaseapp.jsx';
import { StampButton } from './StampButton.jsx';
import { ShareButton } from './QuestSeriesRow.jsx';
import { TrustTag } from './TrustTag.jsx';
import { DuckMark } from './Logo.jsx';
import { LoadingSpinner } from './LoadingSpinner.jsx';
import { formatRecurrence, toDate, getTrustStatus } from './questSeries.js';
import { buildDirectionsUrl } from './mapLinks.js';
import { callListQuestReviews } from './fetch.jsx';
import {
  IconPin,
  IconCalendar,
  IconPhone,
  IconGlobe,
  IconMail,
  IconInstagram,
  IconFacebook,
  IconX,
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

// Organizations' Community Photos gallery (org.photos, an array of Storage
// paths — see OrganizationProfile.jsx's OrgPhotoGallery, which this mirrors)
// as a hero carousel: auto-advances every 5s, no manual controls at all —
// anyone who wants to linger on a specific photo already has the org's own
// profile page (linked right below) to browse the same gallery at their own
// pace. Falls back to the org's logo, then the plain DuckMark placeholder,
// whenever there are zero photos to show — same fallback MapQuestDetailBody
// always had, just one layer deeper now.
function HeroCarousel({ photoPaths, orgLogoUrl }) {
  const [urls, setUrls] = useState([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!photoPaths || photoPaths.length === 0) {
      setUrls([]);
      return undefined;
    }
    let cancelled = false;
    Promise.all(
      photoPaths.map((p) =>
        // Some seeded demo orgs have external placeholder URLs in this
        // field from before it had a real writer — only genuine Storage
        // paths need resolving (see OrgPhotoGallery's own identical note).
        /^https?:\/\//.test(p) ? Promise.resolve(p) : getDownloadURL(storageRef(storage, p)).catch(() => null),
      ),
    ).then((resolved) => {
      if (!cancelled) setUrls(resolved.filter(Boolean));
    });
    return () => {
      cancelled = true;
    };
  }, [photoPaths]);

  useEffect(() => {
    setIndex(0);
    if (urls.length < 2) return undefined;
    const id = setInterval(() => setIndex((i) => (i + 1) % urls.length), 5000);
    return () => clearInterval(id);
  }, [urls.length]);

  if (urls.length === 0) {
    return orgLogoUrl ? (
      <img src={orgLogoUrl} alt="" className="map-quest-hero-img" />
    ) : (
      <div className="map-quest-hero-fallback" aria-hidden="true">
        <DuckMark size={64} />
      </div>
    );
  }

  return (
    <div className="map-quest-hero-carousel">
      <div
        className="map-quest-hero-carousel-track"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {urls.map((url, i) => (
          <img key={i} src={url} alt="" className="map-quest-hero-img" />
        ))}
      </div>
    </div>
  );
}

// This quest's reviews (list_quest_reviews has no ownership gate — any
// signed-in user can call it, same as mobile/Quests.jsx's own
// QuestReviewsList, which this mirrors). `questId` can be any occurrence in
// the series (the callable resolves the series itself server-side), so the
// earliest one (primary.id) always works regardless of which date someone
// last had selected elsewhere.
function ReviewsTab({ questId }) {
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    callListQuestReviews(questId)
      .then((data) => {
        if (!cancelled) {
          setReviews(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Could not load reviews.');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [questId]);

  if (loading) return <LoadingSpinner label="Loading reviews..." />;
  if (error) return <p className="box-danger">{error}</p>;

  return (
    <ul className="data-sublist">
      {reviews.length === 0 && <li>No reviews yet.</li>}
      {reviews.map((r) => (
        <li key={`${r.uid}-${r.eventDate}`}>
          {formatStars(r.rating)} — {r.name || 'Unnamed'}
          {r.eventDate ? ` (${formatEventDate(r.eventDate)})` : ''}: {r.body}
        </li>
      ))}
    </ul>
  );
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
      {org.reason && <p style={{ margin: '0 0 10px' }}>{org.reason}</p>}
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
// `onClose` (optional) renders a close button floating directly on the hero
// photo itself, matching how a real photo lightbox close button sits over
// the image — only MapQuestOverlay.jsx passes this; MapQuestPage.jsx (a
// full standalone page, not an overlay) has nothing to close.
//
// `series.org` (see useMapQuestSeries.js) is the owning organization's full
// profile doc — optional, and every field read off it below just doesn't
// render when absent.
export function MapQuestDetailBody({ series, fullDetailsHref, onClose }) {
  const { primary, org } = series;
  const [tab, setTab] = useState('overview');
  const trustStatus = getTrustStatus(org?.reviewCount || 0, org?.avgRating || 0);
  const hasReviews = series.reviewCount > 0;

  return (
    <div className="map-quest-detail-body">
      <div className="map-quest-hero">
        <HeroCarousel photoPaths={org?.photos} orgLogoUrl={org?.logoUrl} />
        {onClose && (
          <button type="button" className="map-quest-hero-close" onClick={onClose} aria-label="Close">
            <IconX width={18} height={18} />
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
      {primary.orgName && (
        <div className="flex items-center gap-sm" style={{ marginTop: 4, flexWrap: 'wrap' }}>
          {primary.orgId ? (
            <Link to={`/organizations/${primary.orgId}`} className="quest-org-line">
              {primary.orgName}
            </Link>
          ) : (
            <span className="quest-org-line">{primary.orgName}</span>
          )}
          <TrustTag status={trustStatus} />
        </div>
      )}

      <div className="map-quest-info-block" style={{ marginTop: 10 }}>
        {primary.location && (
          <a
            href={buildDirectionsUrl(primary.lat, primary.lng)}
            target="_blank"
            rel="noopener noreferrer"
            className="quest-meta-row quest-meta-link"
          >
            <IconPin /> {primary.location}
          </a>
        )}
        {formatRecurrence(primary) ? (
          <p className="quest-meta-row">
            <IconCalendar /> {formatRecurrence(primary)}
          </p>
        ) : (
          formatEventDate(primary.eventDate) && (
            <p className="quest-meta-row">
              <IconCalendar /> {formatEventDate(primary.eventDate)}
            </p>
          )
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

      {tab === 'reviews' && hasReviews && <ReviewsTab questId={primary.id} />}

      {tab === 'about' && <AboutTab org={org} />}

      <div className="flex items-center gap-sm" style={{ marginTop: 12 }}>
        <StampButton as={Link} to={fullDetailsHref} variant="primary">
          View full quest details
        </StampButton>
        <ShareButton seriesId={series.seriesId} iconOnly />
      </div>
    </div>
  );
}
