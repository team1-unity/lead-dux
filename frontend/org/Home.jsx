import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { AmbientParticles } from '@shared/AmbientParticles.jsx';
import { NotificationBanner } from '@shared/NotificationBanner.jsx';
import { OrgAvatar } from '@shared/OrgAvatar.jsx';
import { TrustTag } from '@shared/TrustTag.jsx';
import { getTrustStatus, groupBySeries, isUpcoming } from '@shared/questSeries.js';

// A couple of lines of what's actually waiting on that page — cut off
// (faded, not truncated with an ellipsis-per-line) rather than shown in
// full, since this is a preview, not the real list. `empty` covers the
// "nothing here" case so the tile still reads as intentional, not broken.
function StatPreview({ items, empty }) {
  if (items.length === 0) return <p className="field-optional org-home-stat-preview" style={{ marginTop: 6 }}>{empty}</p>;
  return (
    <div className="org-home-stat-preview">
      <ul>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

// The org's new landing screen (see BottomNav's PRIMARY_BY_ROLE.organization)
// — a status pill plus at-a-glance stat-tiles, replacing the old single
// everything-inlined Dashboard.jsx. Each tile links to its own full page
// (org/PhotoSubmissions.jsx, org/FeedbackRequests.jsx, org/Quests.jsx) and
// doubles as a preview of it, rather than duplicating that page's content
// in full here.
export function Home() {
  const { user } = useAuth();
  const [org, setOrg] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'organizations', user.uid)).then((snap) => {
      if (snap.exists()) setOrg(snap.data());
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([
      getDocs(query(collection(db, 'photoSubmissions'), where('status', '==', 'pending'), where('orgId', '==', user.uid))),
      getDocs(query(collection(db, 'feedbackRequests'), where('status', '==', 'pending'), where('orgId', '==', user.uid))),
      getDocs(query(collection(db, 'quests'), where('orgId', '==', user.uid))),
    ]).then(([photoSnap, feedbackSnap, questsSnap]) => {
      if (cancelled) return;
      const quests = questsSnap.docs.map((d) => d.data()).filter(isUpcoming);
      setData({
        photoSubmissions: photoSnap.docs.map((d) => d.data()),
        feedbackRequests: feedbackSnap.docs.map((d) => d.data()),
        quests: groupBySeries(quests),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (org === null || data === null) return <LoadingSpinner label="Loading…" />;

  const trustStatus = getTrustStatus(org.reviewCount || 0, org.avgRating || 0);

  return (
    <>
      {/* Sibling of PageMotion, not its child — see mobile/Home.jsx's own
          note on why (PageMotion's transform opens a new stacking context
          that would otherwise cap this banner's z-index against only its
          own siblings inside PageMotion, not the page's real content). */}
      <NotificationBanner />
      <PageMotion>
        <AmbientParticles />
      <div className="org-home-greeting">
        <Link to={`/organizations/${user.uid}`} className="org-home-avatar-link" aria-label="View your public profile">
          <OrgAvatar name={org.name} seed={user.uid} logoUrl={org.logoUrl} />
        </Link>
        <div>
          <h1>Hello, {org.name}</h1>
          <TrustTag status={trustStatus} />
        </div>
      </div>

      {trustStatus === 'under_review' && (
        <p className="box-danger" style={{ marginBottom: 20 }}>
          Your ratings have fallen low enough that your organization is under review. Improve your Trust
          Score by delivering the experience your quests describe — an admin may also reach out.
        </p>
      )}

      <div className="org-home-stats">
        <Link to="/org/photo-submissions" className="ink-card org-home-stat-tile">
          <span className="stat-hero-number">{data.photoSubmissions.length}</span>
          <span className="stat-hero-label">Pending Photo Submissions</span>
          <StatPreview
            items={data.photoSubmissions.slice(0, 3).map((s) => `${s.userName || 'Someone'} — ${s.questTitle}`)}
            empty="Nothing pending right now."
          />
        </Link>
        <Link to="/org/feedback-requests" className="ink-card org-home-stat-tile">
          <span className="stat-hero-number">{data.feedbackRequests.length}</span>
          <span className="stat-hero-label">Pending Feedback Requests</span>
          <StatPreview
            items={data.feedbackRequests.slice(0, 3).map((r) => r.questTitle)}
            empty="Nothing pending right now."
          />
        </Link>
        <Link to="/org/quests" className="ink-card org-home-stat-tile">
          <span className="stat-hero-number">{data.quests.length}</span>
          <span className="stat-hero-label">Your Quests</span>
          <StatPreview
            items={data.quests.slice(0, 3).map((s) => s.primary.title)}
            empty="No active quests right now."
          />
        </Link>
      </div>
      </PageMotion>
    </>
  );
}
