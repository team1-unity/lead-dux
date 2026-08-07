import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { db, storage } from './firebaseapp.jsx';
import { callAddSubmissionToGallery } from './fetch.jsx';
import { LoadingSpinner } from './LoadingSpinner.jsx';
import { StampButton } from './StampButton.jsx';
import { LightboxBackdrop } from './LightboxBackdrop.jsx';

// For submissions an org has already approved — the only action here is
// "Add to gallery" (see add_submission_to_gallery in functions/main.py),
// not approve/reject. Org-only: side-quest submissions (reviewed by an
// admin, no owning org) never have anywhere to add to, so this is only
// ever mounted from frontend/org/PhotoSubmissions.jsx.
//
// One flat grid across every approved quest, not grouped/collapsible by
// quest the way the pending queue used to render (and the way
// PendingPhotoSubmissions.jsx still does for the admin dashboard) — an org
// deciding what to add to its own public gallery is picking individual
// photos it likes, not working through one quest's approvals at a time, so
// there's no reason to make it drill into a per-quest section first. The
// quest title still shows on each card (see ApprovedCard below) so that
// context isn't lost, it's just not a grouping/sort key anymore.
function ApprovedCard({ submission, url, busy, onAdd }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const added = Boolean(submission.addedToGallery);

  return (
    <div className="ink-card submission-card">
      <p className="submission-card-name">{submission.userName || 'Unnamed'}</p>
      {/* The quest title used to be the group heading these cards sat
          under (see this file's own module note) — now that every
          approved photo sits in one flat grid regardless of quest, it
          shows here instead so that context isn't lost. */}
      <p className="data-stat" style={{ marginTop: -2, marginBottom: 4 }}>{submission.questTitle}</p>
      {url ? (
        <button
          type="button"
          className="submission-thumb-btn"
          onClick={() => setLightboxOpen(true)}
          aria-label={`View ${submission.userName || 'submitted'} photo full size`}
        >
          <img src={url} alt="" className="submission-thumb-img" />
        </button>
      ) : (
        <div className="submission-thumb-img" aria-hidden="true" />
      )}
      {submission.reflection && <p className="data-row-sub">{submission.reflection}</p>}
      <div className="data-row-actions" style={{ marginTop: 8 }}>
        <StampButton type="button" variant="primary" onClick={onAdd} disabled={busy || added}>
          {added ? 'Added to gallery' : busy ? 'Adding...' : 'Add to gallery'}
        </StampButton>
      </div>

      {lightboxOpen && url && (
        <LightboxBackdrop onClose={() => setLightboxOpen(false)} label="Approved photo">
          <div className="photo-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={url} alt="Approved submission" className="photo-lightbox-image" />
          </div>
        </LightboxBackdrop>
      )}
    </div>
  );
}

// scopeValue is always the caller's own orgId — approved submissions for
// anyone else's quests are never fetched. title lets the mounting page
// (org/PhotoSubmissions.jsx) drop it under its pending queue with its own
// heading.
export function ApprovedPhotoSubmissions({ orgId, title = 'Approved — add to your gallery' }) {
  const [submissions, setSubmissions] = useState(null);
  const [urls, setUrls] = useState({});
  const [busyId, setBusyId] = useState(null);

  async function load() {
    const snap = await getDocs(
      query(collection(db, 'photoSubmissions'), where('status', '==', 'approved'), where('orgId', '==', orgId)),
    );
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setSubmissions(rows);
    const entries = await Promise.all(
      rows.map(async (r) => {
        if (/^https?:\/\//.test(r.storagePath)) return [r.id, r.storagePath];
        return [r.id, await getDownloadURL(storageRef(storage, r.storagePath)).catch(() => null)];
      }),
    );
    setUrls(Object.fromEntries(entries));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function add(s) {
    setBusyId(s.id);
    try {
      await callAddSubmissionToGallery({ questId: s.questId, userId: s.userId });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (!submissions) return <LoadingSpinner label="Loading approved photos..." />;

  return (
    <section style={{ marginBottom: 24 }}>
      <h2>{title}</h2>
      {submissions.length === 0 ? (
        <p>No approved photos yet.</p>
      ) : (
        <div className="submission-grid">
          {submissions.map((s) => (
            <ApprovedCard key={s.id} submission={s} url={urls[s.id]} busy={busyId === s.id} onAdd={() => add(s)} />
          ))}
        </div>
      )}
    </section>
  );
}
