import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { db, storage } from '@shared/firebaseapp.jsx';
import { useAuth } from '@shared/AuthContext.jsx';
import { callApprovePhotoSubmission, callRejectPhotoSubmission } from '@shared/fetch.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { LightboxBackdrop } from '@shared/LightboxBackdrop.jsx';
import { DuckMark } from '@shared/Logo.jsx';
import { IconCheck, IconX } from '@shared/icons.jsx';

// A Tinder-style moderation queue for an org's own pending photo
// submissions — a from-scratch component (not a rework of
// frontend/template/PendingPhotoSubmissions.jsx, which stays exactly as-is
// for the admin dashboard's side-quest review). Flat, not grouped by quest
// (confirmed: an org reviewing wants one queue to burn through, not a
// per-quest drill-down) — each tile/card instead shows the quest title and
// submitter name directly as an overlay, which is what grouping used to
// convey.
//
// Combines two adapted reference patterns: a bento-style grid (click a
// tile to open a review modal) and a swipeable card stack inside that
// modal (drag right to approve, drag left to disapprove, with a colored
// inner-glow that builds as you drag and a fly-off exit on decision).
const SWIPE_THRESHOLD = 100;

// Cycles a few grid-span sizes across tiles purely for visual variety —
// this data has no natural "span" field the way a real bento layout tool
// would, so the pattern is index-based, not content-based.
function tileSpanClass(index) {
  const pattern = index % 7;
  if (pattern === 0) return 'pending-photo-tile--big';
  if (pattern === 3) return 'pending-photo-tile--wide';
  if (pattern === 5) return 'pending-photo-tile--tall';
  return '';
}

const gridVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const tileVariants = {
  hidden: { y: 30, scale: 0.9, opacity: 0 },
  visible: { y: 0, scale: 1, opacity: 1, transition: { type: 'spring', stiffness: 350, damping: 28 } },
};

// One card in the swipe stack. Only the top card (isTop) is actually
// draggable — the rest sit slightly scaled-down/offset behind it, same as
// the reference's isTopCard-gated `drag` prop. `direction` (set by the
// parent, live while dragging or fixed once a decision fires) drives both
// the colored inner-glow and, via the `custom` prop, which way the exit
// variant sends the card flying.
function ReviewCard({ photo, isTop, direction, onDrag, onDragEnd }) {
  return (
    <motion.div
      className="pending-review-card"
      style={{ zIndex: isTop ? 2 : 1 }}
      drag={isTop ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      onDrag={isTop ? (e, info) => onDrag(info) : undefined}
      onDragEnd={isTop ? (e, info) => onDragEnd(info) : undefined}
      custom={{ direction }}
      initial={{ scale: 0.95, y: 20, opacity: 0 }}
      animate={{
        scale: isTop ? 1 : 0.95,
        y: isTop ? 0 : -16,
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      }}
      exit="exit"
      variants={{
        exit: (custom) => ({
          x: (custom?.direction || 'left') === 'right' ? 300 : -300,
          rotate: (custom?.direction || 'left') === 'right' ? 20 : -20,
          opacity: 0,
          transition: { duration: 0.3, ease: 'easeIn' },
        }),
      }}
    >
      <img src={photo.url} alt="" className="pending-review-card-img" draggable={false} />
      {isTop && direction && (
        <div
          className="pending-review-card-glow"
          style={{
            boxShadow:
              direction === 'right'
                ? 'inset 0px -120px 90px color-mix(in srgb, var(--accent) 55%, transparent)'
                : 'inset 0px -120px 90px color-mix(in srgb, var(--danger) 55%, transparent)',
          }}
        />
      )}
      <div className="pending-review-card-overlay">
        <p className="pending-review-card-title">{photo.questTitle}</p>
        <p className="pending-review-card-desc">{photo.userName || 'Unnamed'}</p>
      </div>
    </motion.div>
  );
}

// The bottom thumbnail dock — draggable as a whole panel (repositionable
// anywhere on screen, same as the reference), each thumbnail jumping the
// stack straight to that photo on click. Rotation removed entirely per
// spec: the reference tilts each thumbnail +/-15deg at rest and animates
// back to 0 only when active/hovered — every `rotate` keyframe below is
// just gone, at rest and on hover/active alike, so thumbnails always sit
// flat.
function ReviewDock({ photos, activeId, onSelect }) {
  const [dockPosition, setDockPosition] = useState({ x: 0, y: 0 });

  return (
    // Centering lives on this plain, non-animated wrapper (left:50% +
    // transform:translateX(-50%) in CSS) rather than on the draggable
    // motion.div itself — framer-motion owns that element's `transform`
    // entirely once `animate`/`drag` touch x/y, and would silently clobber
    // a CSS transform set on the same element (the reference's own
    // `-translate-x-1/2` on its draggable div has exactly this problem).
    // Wrapping keeps the actual centering unaffected by wherever the drag
    // has moved the inner dock to.
    <div className="pending-review-dock-wrap">
      <motion.div
        drag
        dragMomentum={false}
        dragElastic={0.1}
        initial={false}
        animate={{ x: dockPosition.x, y: dockPosition.y }}
        onDragEnd={(_, info) =>
          setDockPosition((prev) => ({ x: prev.x + info.offset.x, y: prev.y + info.offset.y }))
        }
        className="pending-review-dock"
      >
        <div className="pending-review-dock-inner">
          {photos.map((p) => (
            <motion.button
              key={p.id}
              type="button"
              className="pending-review-dock-thumb"
              data-active={p.id === activeId ? 'true' : undefined}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(p.id);
              }}
              aria-label={`Jump to ${p.userName || 'submission'}'s photo`}
              // rotation removed per spec — no initial/animate rotate here at all
              animate={{ scale: p.id === activeId ? 1.2 : 1, y: p.id === activeId ? -8 : 0 }}
              whileHover={{ scale: 1.3, y: -10, transition: { type: 'spring', stiffness: 400, damping: 25 } }}
            >
              <img src={p.url} alt="" draggable={false} />
              {p.id === activeId && (
                <motion.div
                  layoutId="activeGlow"
                  className="pending-review-dock-glow"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                />
              )}
            </motion.button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

export function PendingPhotoReview() {
  const { user } = useAuth();
  const [photos, setPhotos] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [dragDirections, setDragDirections] = useState({});
  const [pendingReject, setPendingReject] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionError, setActionError] = useState('');
  const reduce = useReducedMotion();
  const topPhotoRef = useRef(null);

  async function load() {
    const snap = await getDocs(
      query(collection(db, 'photoSubmissions'), where('status', '==', 'pending'), where('orgId', '==', user.uid)),
    );
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const withUrls = await Promise.all(
      rows.map(async (r) => {
        // Already a real URL — seeded demo submissions use external
        // (picsum.photos) placeholder URLs here, same reasoning as
        // OrganizationProfile.jsx's OrgPhotoGallery. Only genuine Storage
        // paths (real uploads via submit_quest_photo) need resolving.
        const url = /^https?:\/\//.test(r.storagePath)
          ? r.storagePath
          : await getDownloadURL(storageRef(storage, r.storagePath)).catch(() => null);
        return { ...r, url };
      }),
    );
    setPhotos(withUrls);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid]);

  const topPhoto = photos && photos.length > 0 ? photos[photos.length - 1] : null;
  topPhotoRef.current = topPhoto;

  // Moves a photo to the end of the array — the one place "current card"
  // is defined (last element), so both opening the modal on a grid tile
  // and clicking a dock thumbnail reduce to the same operation.
  function bringToTop(id) {
    setPhotos((prev) => {
      const item = prev.find((p) => p.id === id);
      if (!item) return prev;
      return [...prev.filter((p) => p.id !== id), item];
    });
  }

  function openReview(id) {
    bringToTop(id);
    setReviewOpen(true);
  }

  function closeReview() {
    setReviewOpen(false);
  }

  async function approvePhoto(photo) {
    try {
      await callApprovePhotoSubmission({ questId: photo.questId, userId: photo.userId });
    } catch (err) {
      setActionError(err.message || 'Could not approve this photo.');
    }
  }

  // Approve fires immediately; disapprove instead opens the optional-
  // reason prompt (see resolveReject) — the actual reject call happens
  // once that resolves (Submit or Cancel), not here, since the backend
  // only accepts one reject call per submission and needs whatever reason
  // (or none) the org lands on.
  function handleDecision(photo, direction) {
    setDragDirections((prev) => ({ ...prev, [photo.id]: direction }));
    setTimeout(() => {
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      setDragDirections((prev) => {
        const next = { ...prev };
        delete next[photo.id];
        return next;
      });
      if (direction === 'right') {
        approvePhoto(photo);
      } else {
        setPendingReject(photo);
      }
    }, 300);
  }

  async function resolveReject(reason) {
    const photo = pendingReject;
    setPendingReject(null);
    setRejectReason('');
    if (!photo) return;
    try {
      await callRejectPhotoSubmission({ questId: photo.questId, userId: photo.userId, reason: reason || undefined });
    } catch (err) {
      setActionError(err.message || 'Could not reject this photo.');
    }
  }

  function handleDrag(info) {
    if (!topPhoto) return;
    setDragDirections((prev) => ({ ...prev, [topPhoto.id]: info.offset.x > 0 ? 'right' : 'left' }));
  }

  function handleDragEnd(info) {
    if (!topPhoto) return;
    if (Math.abs(info.offset.x) > SWIPE_THRESHOLD) {
      handleDecision(topPhoto, info.offset.x > 0 ? 'right' : 'left');
    } else {
      setDragDirections((prev) => ({ ...prev, [topPhoto.id]: null }));
    }
  }

  // Keyboard support while the review modal is open — Escape is already
  // handled by LightboxBackdrop itself; Arrow keys mirror the swipe
  // directions. Ignored while the reason-prompt is up (pendingReject), so
  // an arrow key there doesn't also act on the card underneath it.
  useEffect(() => {
    if (!reviewOpen || pendingReject) return undefined;
    function onKeyDown(e) {
      if (!topPhotoRef.current) return;
      if (e.key === 'ArrowLeft') handleDecision(topPhotoRef.current, 'left');
      else if (e.key === 'ArrowRight') handleDecision(topPhotoRef.current, 'right');
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewOpen, pendingReject]);

  // Only the last few need to actually be mounted — every card past the
  // top 2-3 is fully hidden behind it anyway (same flat stacking the
  // reference itself uses, just capped here so a large backlog doesn't
  // mount dozens of absolutely-positioned cards at once).
  const stackToRender = useMemo(() => (photos ? photos.slice(-5) : []), [photos]);

  if (photos === null) return <LoadingSpinner label="Loading photo submissions…" />;

  return (
    <div>
      <h1>Pending Photo Submissions</h1>
      {actionError && <p className="box-danger">{actionError}</p>}

      {photos.length === 0 ? (
        <p>No pending photo submissions.</p>
      ) : (
        <motion.div className="pending-photo-grid" variants={gridVariants} initial="hidden" animate="visible">
          {photos.map((photo, index) => (
            <motion.button
              key={photo.id}
              type="button"
              className={`pending-photo-tile ${tileSpanClass(index)}`}
              variants={tileVariants}
              whileHover={reduce ? undefined : { scale: 1.02 }}
              onClick={() => openReview(photo.id)}
            >
              {photo.url ? (
                <img src={photo.url} alt="" className="pending-photo-tile-img" />
              ) : (
                <div className="pending-photo-tile-img" aria-hidden="true" />
              )}
              <div className="pending-photo-tile-overlay">
                <p className="pending-photo-tile-title">{photo.questTitle}</p>
                <p className="pending-photo-tile-desc">{photo.userName || 'Unnamed'}</p>
              </div>
            </motion.button>
          ))}
        </motion.div>
      )}

      {reviewOpen && (
        <LightboxBackdrop onClose={closeReview} label="Review pending photos" className="pending-review-backdrop">
          <div className="pending-review-modal" onClick={(e) => e.stopPropagation()}>
            {topPhoto ? (
              <>
                <div className="pending-review-stack">
                  <AnimatePresence>
                    {stackToRender.map((photo) => (
                      <ReviewCard
                        key={photo.id}
                        photo={photo}
                        isTop={photo.id === topPhoto.id}
                        direction={dragDirections[photo.id]}
                        onDrag={handleDrag}
                        onDragEnd={handleDragEnd}
                      />
                    ))}
                  </AnimatePresence>
                </div>

                <p className="pending-review-instructions">Swipe left to disapprove • Swipe right to approve</p>

                <div className="pending-review-actions">
                  <button
                    type="button"
                    className="pending-review-action pending-review-action-reject"
                    onClick={() => handleDecision(topPhoto, 'left')}
                    aria-label="Disapprove"
                  >
                    <IconX width={22} height={22} />
                  </button>
                  <button
                    type="button"
                    className="pending-review-action pending-review-action-approve"
                    onClick={() => handleDecision(topPhoto, 'right')}
                    aria-label="Approve"
                  >
                    <IconCheck width={22} height={22} />
                  </button>
                </div>

                <ReviewDock photos={photos} activeId={topPhoto.id} onSelect={bringToTop} />
              </>
            ) : (
              // Chose "show a message and let the org close it themselves"
              // over auto-closing the instant the queue empties — closing
              // out from under someone mid-review would read as the modal
              // glitching shut rather than a deliberate "you're done" beat.
              <div className="pending-review-empty">
                <DuckMark size={64} />
                <p>You're all caught up!</p>
              </div>
            )}
          </div>
        </LightboxBackdrop>
      )}

      {pendingReject && (
        <LightboxBackdrop onClose={() => resolveReject(null)} label="Add a rejection reason">
          <div className="detail-modal-content ink-card" onClick={(e) => e.stopPropagation()}>
            <p style={{ marginTop: 0, fontWeight: 700 }}>
              Add a note for {pendingReject.userName || 'this submission'}? (optional)
            </p>
            <textarea
              className="pending-reject-textarea"
              placeholder="Reason (optional)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={300}
            />
            <div className="flex gap-sm" style={{ marginTop: 10 }}>
              <StampButton type="button" variant="primary" onClick={() => resolveReject(rejectReason.trim())}>
                Submit
              </StampButton>
              <StampButton type="button" onClick={() => resolveReject(null)}>
                Cancel
              </StampButton>
            </div>
          </div>
        </LightboxBackdrop>
      )}
    </div>
  );
}
