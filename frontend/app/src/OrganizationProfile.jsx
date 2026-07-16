import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@shared/firebaseapp.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StatusStamp } from '@shared/StatusStamp.jsx';
import { TagStamp } from '@shared/TagStamp.jsx';
import { OrgAvatar } from '@shared/OrgAvatar.jsx';
import { PhotoGallery } from '@shared/PhotoGallery.jsx';
import { formatEventDate } from '@shared/QuestSeriesRow.jsx';
import { groupBySeries, attachSeriesRatings, isUpcoming } from '@shared/questSeries.js';
import { hashTone } from '@shared/tagTones.js';
import {
  IconGlobe,
  IconMail,
  IconPhone,
  IconPin,
  IconInstagram,
  IconFacebook,
  IconX,
  IconLinkedIn,
  IconTikTok,
  IconYouTube,
} from '@shared/icons.jsx';

const SOCIAL_ICONS = {
  instagram: IconInstagram,
  facebook: IconFacebook,
  twitter: IconX,
  linkedin: IconLinkedIn,
  tiktok: IconTikTok,
  youtube: IconYouTube,
};

// Trust Score is only ever shown once an org has at least 3 reviews (see
// the rollup in functions/main.py's _record_review) — anything below that
// reads as "New Organization" instead, so a single early 1-star review
// can't misrepresent an otherwise-untested org.
const MIN_REVIEWS_FOR_TRUST_SCORE = 3;

function TrustScore({ org }) {
  const count = org.ratingCount || 0;
  if (count < MIN_REVIEWS_FOR_TRUST_SCORE) {
    return <span className="data-stat">New Organization</span>;
  }
  const score = org.ratingSum / count;
  return <span className="data-stat">★ {score.toFixed(1)} / 5 ({count} reviews)</span>;
}

function OrgQuestCard({ series }) {
  const { primary, occurrences } = series;
  const rsvpCount = (primary.rsvpd || []).length;
  return (
    <Link to={`/quests/${series.seriesId}`} className="ink-card org-quest-card">
      <p className="quest-title">{primary.title}</p>
      {primary.location && (
        <p className="quest-meta-row">
          <IconPin /> {primary.location}
        </p>
      )}
      {formatEventDate(primary.eventDate) && (
        <p className="quest-org-line">
          {formatEventDate(primary.eventDate)}
          {occurrences.length > 1 ? ` (+${occurrences.length - 1} more date${occurrences.length > 2 ? 's' : ''})` : ''}
        </p>
      )}
      <p className="data-stat">{rsvpCount} RSVP'd</p>
    </Link>
  );
}

// The organization's public "home" within the app — reachable by any
// signed-in role (not gated to a specific one, same as browsing quests
// itself). Organization docs are readable by any signed-in user (see
// firestore.rules) since every field on them is meant to be public once
// approved; quests are read the same direct-client-query way the main
// Quests page already reads them.
export function OrganizationProfile() {
  const { orgId } = useParams();
  const [org, setOrg] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [seriesList, setSeriesList] = useState(null);

  useEffect(() => {
    getDoc(doc(db, 'organizations', orgId)).then((snap) => {
      if (!snap.exists()) {
        setNotFound(true);
        return;
      }
      setOrg(snap.data());
    });
  }, [orgId]);

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, 'quests'), where('orgId', '==', orgId))),
      getDocs(collection(db, 'questSeries')),
    ]).then(([questsSnap, seriesSnap]) => {
      const quests = questsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(isUpcoming);
      const seriesDocsById = new Map(seriesSnap.docs.map((d) => [d.id, d.data()]));
      setSeriesList(attachSeriesRatings(groupBySeries(quests), seriesDocsById));
    });
  }, [orgId]);

  if (notFound) return <Navigate to="/" replace />;
  if (!org) return <LoadingSpinner label="Loading organization..." />;

  const socialEntries = Object.entries(org.socialLinks || {}).filter(([, url]) => url);

  return (
    <PageMotion>
      <div className="ink-card org-profile-header">
        {org.logoUrl ? (
          <img src={org.logoUrl} alt="" className="org-profile-logo" />
        ) : (
          <OrgAvatar name={org.name} seed={orgId} />
        )}
        <div className="org-profile-header-info">
          <div className="flex items-center gap-sm">
            <h1 style={{ margin: 0 }}>{org.name}</h1>
            {org.verified && <StatusStamp tone="verified">Verified</StatusStamp>}
          </div>
          <div className="flex items-center gap-sm" style={{ marginTop: 6 }}>
            <TrustScore org={org} />
            {org.category && <TagStamp tone={hashTone(org.category)}>{org.category}</TagStamp>}
          </div>
        </div>
      </div>

      <div className="profile-grid">
        <section className="ink-card">
          <h2 style={{ marginTop: 0 }}>About</h2>
          {org.missionStatement && <p style={{ margin: 0 }}>{org.missionStatement}</p>}
          {org.reason && <p style={{ margin: org.missionStatement ? '10px 0 0' : 0 }}>{org.reason}</p>}
          {(org.city || org.state) && (
            <p className="data-stat" style={{ marginTop: 10 }}>
              <IconPin /> {[org.city, org.state].filter(Boolean).join(', ')}
            </p>
          )}
          {org.website && (
            <p className="data-stat">
              <IconGlobe />{' '}
              <a href={org.website} target="_blank" rel="noreferrer">{org.website}</a>
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
        </section>

        <section className="ink-card">
          <h2 style={{ marginTop: 0 }}>Active Quests</h2>
          {seriesList === null ? (
            <LoadingSpinner label="Loading quests..." />
          ) : seriesList.length === 0 ? (
            <p className="data-stat">No active quests right now.</p>
          ) : (
            <div className="org-quest-grid">
              {seriesList.map((series) => (
                <OrgQuestCard key={series.seriesId} series={series} />
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="ink-card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Community Photos</h2>
        <PhotoGallery photos={org.photos || []} />
      </section>
    </PageMotion>
  );
}
