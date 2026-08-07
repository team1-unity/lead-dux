import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { db, storage } from './firebaseapp.jsx';
import { callApprovePhotoSubmission, callRejectPhotoSubmission } from './fetch.jsx';
import { LoadingSpinner } from './LoadingSpinner.jsx';
import { StampButton } from './StampButton.jsx';
import { Collapse } from './Collapse.jsx';
import { LightboxBackdrop } from './LightboxBackdrop.jsx';
import { IconChevron } from './icons.jsx';

// Flat submission rows grouped into one entry per quest — matches the
// wireframe's Title (quest) → grid-of-users shape instead of one long flat
// list, since a reviewer thinks in terms of "who submitted for this quest,"
// not one undifferentiated queue.
function groupByQuest(rows) {
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(r.questId)) map.set(r.questId, { questId: r.questId, questTitle: r.questTitle, items: [] });
    map.get(r.questId).items.push(r);
  });
  return [...map.values()];
}

// One submitting user's card within a quest's group — name, then only the
// photo itself is a tap target (opens the full-size lightbox, same
// backdrop/close pattern as PhotoGallery.jsx's), with reflection (side
// quests only) and Approve/Decline always visible below it rather than
// gated behind an expand step.
function SubmissionCard({ submission, url, busy, allowGalleryKeep, onApprove, onReject }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  // Defaults on: an org reviewing its own submissions is far more often
  // building its gallery than not, and un-checking is one click either way.
  const [keepForGallery, setKeepForGallery] = useState(true);

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
      {/* Side quests only — organization submissions have no reflection field at all. */}
      {submission.reflection && <p className="data-row-sub">{submission.reflection}</p>}
      {/* Org-owned quests only — a side quest has no gallery to add to (see
          this component's own module note), so admin's side-quest review
          never gets this checkbox. */}
      {allowGalleryKeep && (
        <label className="flex items-center gap-sm field-optional" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={keepForGallery}
            onChange={(e) => setKeepForGallery(e.target.checked)}
            disabled={busy}
          />
          Add to gallery if approved
        </label>
      )}
      <div className="data-row-actions" style={{ marginTop: 8 }}>
        <StampButton
          type="button"
          variant="primary"
          onClick={() => onApprove(allowGalleryKeep && keepForGallery)}
          disabled={busy}
        >
          {busy ? 'Approving…' : 'Approve'}
        </StampButton>
        <StampButton type="button" variant="danger" onClick={() => setRejecting((v) => !v)} disabled={busy}>
          Reject
        </StampButton>
      </div>
      {rejecting && (
        <div className="flex flex-col gap-sm" style={{ marginTop: 8 }}>
          <textarea placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <StampButton type="button" variant="danger" onClick={() => onReject(reason)} disabled={busy}>
            {busy ? 'Rejecting…' : 'Confirm reject'}
          </StampButton>
        </div>
      )}

      {lightboxOpen && url && (
        <LightboxBackdrop onClose={() => setLightboxOpen(false)} label="Submitted photo">
          <div className="photo-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={url} alt="Submitted proof" className="photo-lightbox-image" />
          </div>
        </LightboxBackdrop>
      )}
    </div>
  );
}

// One quest's group — collapsed to title + submission count, expanding to
// the grid of its individual submitters. Open by default: a reviewer
// landing on this page wants to see what's waiting, not click through an
// extra layer of collapse first.
function QuestSubmissionGroup({ group, urls, busyId, allowGalleryKeep, onApprove, onReject }) {
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
            {group.items.length} submission{group.items.length === 1 ? '' : 's'}
          </p>
        </div>
        <IconChevron className="quest-chevron" data-open={open ? 'true' : 'false'} />
      </button>

      <Collapse open={open}>
        <div className="submission-grid" style={{ marginTop: 12 }}>
          {group.items.map((s) => (
            <SubmissionCard
              key={s.id}
              submission={s}
              url={urls[s.id]}
              busy={busyId === s.id}
              allowGalleryKeep={allowGalleryKeep}
              onApprove={(addToGallery) => onApprove(s, addToGallery)}
              onReject={(reason) => onReject(s, reason)}
            />
          ))}
        </div>
      </Collapse>
    </section>
  );
}

// Reviewer queue for pending quest photo submissions (see
// submit_quest_photo/approve_photo_submission/reject_photo_submission in
// functions/main.py). Used by both the org dashboard (own quests —
// scopeField="orgId", scopeValue={user.uid}) and the admin dashboard (side
// quests — scopeField="isDefault", scopeValue={true}); approve/reject are
// gated server-side by ownership, this component just scopes which
// pending submissions are queried for.
export function PendingPhotoSubmissions({
  scopeField,
  scopeValue,
  title = 'Pending photo submissions',
  allowGalleryKeep = false,
}) {
  const [submissions, setSubmissions] = useState(null);
  const [urls, setUrls] = useState({});
  const [busyId, setBusyId] = useState(null);

  async function load() {
    const snap = await getDocs(
      query(collection(db, 'photoSubmissions'), where('status', '==', 'pending'), where(scopeField, '==', scopeValue)),
    );
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setSubmissions(rows);
    const entries = await Promise.all(
      rows.map(async (r) => {
        // Already a real URL — seeded demo submissions use external
        // (picsum.photos) placeholder URLs here, same reasoning as
        // OrganizationProfile.jsx's OrgPhotoGallery. Only genuine Storage
        // paths (real uploads via submit_quest_photo) need resolving.
        if (/^https?:\/\//.test(r.storagePath)) return [r.id, r.storagePath];
        return [r.id, await getDownloadURL(storageRef(storage, r.storagePath)).catch(() => null)];
      }),
    );
    setUrls(Object.fromEntries(entries));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeField, scopeValue]);

  async function approve(s, addToGallery) {
    setBusyId(s.id);
    try {
      await callApprovePhotoSubmission({ questId: s.questId, userId: s.userId, addToGallery });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function reject(s, reason) {
    setBusyId(s.id);
    try {
      await callRejectPhotoSubmission({ questId: s.questId, userId: s.userId, reason });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (!submissions) return <LoadingSpinner label="Loading photo submissions…" />;

  const groups = groupByQuest(submissions);

  return (
    <section style={{ marginBottom: 24 }}>
      <h2>{title}</h2>
      {groups.length === 0 ? (
        <p>No pending photo submissions.</p>
      ) : (
        <div className="flex flex-col gap-md">
          {groups.map((group) => (
            <QuestSubmissionGroup
              key={group.questId}
              group={group}
              urls={urls}
              busyId={busyId}
              allowGalleryKeep={allowGalleryKeep}
              onApprove={approve}
              onReject={reject}
            />
          ))}
        </div>
      )}
    </section>
  );
}
