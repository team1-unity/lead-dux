import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { db, storage } from './firebaseapp.jsx';
import { callAddSubmissionToGallery } from './fetch.jsx';
import { LoadingSpinner } from './LoadingSpinner.jsx';
import { StampButton } from './StampButton.jsx';
import { LightboxBackdrop } from './LightboxBackdrop.jsx';
import { IconChevron, IconX } from './icons.jsx';

// Mirrors PendingPhotoSubmissions.jsx's grouped-by-quest shape, but for
// submissions an org has already approved — the only action here is
// "Add to gallery" (see add_submission_to_gallery in functions/main.py),
// not approve/reject. Org-only: side-quest submissions (reviewed by an
// admin, no owning org) never have anywhere to add to, so this is only
// ever mounted from frontend/org/PhotoSubmissions.jsx.
function groupByQuest(rows) {
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(r.questId)) map.set(r.questId, { questId: r.questId, questTitle: r.questTitle, items: [] });
    map.get(r.questId).items.push(r);
  });
  return [...map.values()];
}

function ApprovedCard({ submission, url, busy, onAdd }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const added = Boolean(submission.addedToGallery);

  return (
    <div className="ink-card submission-card">
      <p className="submission-card-name">{submission.userName || 'Unnamed'}</p>
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
            <button
              type="button"
              className="photo-lightbox-close"
              onClick={() => setLightboxOpen(false)}
              aria-label="Close"
            >
              <IconX width={18} height={18} />
            </button>
          </div>
        </LightboxBackdrop>
      )}
    </div>
  );
}

function QuestApprovedGroup({ group, urls, busyId, onAdd }) {
  const [open, setOpen] = useState(true);

  return (
    <section className="ink-card">
      <button
        type="button"
        className="quest-card-head"
        style={{ padding: 0 }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="quest-card-titles">
          <h3 style={{ marginBottom: 0 }}>{group.questTitle}</h3>
          <p className="data-stat" style={{ marginTop: 4 }}>
            {group.items.length} approved photo{group.items.length === 1 ? '' : 's'}
          </p>
        </div>
        <IconChevron className="quest-chevron" data-open={open ? 'true' : 'false'} />
      </button>

      {open && (
        <div className="submission-grid" style={{ marginTop: 12 }}>
          {group.items.map((s) => (
            <ApprovedCard key={s.id} submission={s} url={urls[s.id]} busy={busyId === s.id} onAdd={() => onAdd(s)} />
          ))}
        </div>
      )}
    </section>
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

  const groups = groupByQuest(submissions);

  return (
    <section style={{ marginBottom: 24 }}>
      <h2>{title}</h2>
      {groups.length === 0 ? (
        <p>No approved photos yet.</p>
      ) : (
        <div className="flex flex-col gap-md">
          {groups.map((group) => (
            <QuestApprovedGroup key={group.questId} group={group} urls={urls} busyId={busyId} onAdd={add} />
          ))}
        </div>
      )}
    </section>
  );
}
