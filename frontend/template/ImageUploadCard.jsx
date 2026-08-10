import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { IconUpload, IconX } from './icons.jsx';

// A single-image drag-and-drop/click-to-upload card, built around one
// specific animation: once a file lands, it "drops" into the frame from
// above with a slow-start/fast-finish gravity curve, then bounces once on
// landing — a vending machine dispensing, not a fade-in. Every timing/
// easing value below (the 1.2s drop, the [0.55,0.055,0.675,0.19] curve,
// the delay:0.7 spring bounce) is deliberate and tuned together; don't
// adjust one without the others.
//
// Single image only, no multi-file support — dropping/selecting a new
// image while one exists just replaces it (see handleFile's own revoke-
// before-replace), but the click-to-open-file-picker path is gated off
// once a file is present (see handleZoneClick) so there's no ambiguity
// about which of two ways to add a second image actually "wins."

const IMAGE_UPLOAD_SIMULATED_DELAY_MS = 200;

function truncateFilename(filename, maxLength = 30) {
  // null whenever a caller seeds initialPreviewUrl without an
  // initialFileName (a documented, valid combination — see this
  // component's own module note: "there's no real File behind" a seeded
  // image, so there's often no real filename to show either).
  if (!filename || filename.length <= maxLength) return filename;
  const dotIndex = filename.lastIndexOf('.');
  const extension = dotIndex >= 0 ? filename.slice(dotIndex + 1) : '';
  const nameWithoutExt = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;
  const truncatedName = nameWithoutExt.slice(0, Math.max(0, maxLength - 3 - extension.length));
  return extension ? `${truncatedName}...${extension}` : `${truncatedName}...`;
}

function joinClassNames(...classes) {
  return classes.filter(Boolean).join(' ');
}

// The dropped-in image itself — a thin wrapper around the drop
// animation, kept separate from ImageUploadCard so the animation's own
// mount/unmount lifecycle (AnimatePresence, the isRemoving exit) doesn't
// get tangled up with the drag/upload state driving it.
function DroppedImage({ isAnimating, onAnimationComplete, filename, previewUrl, onRemove, reduce }) {
  const [isRemoving, setIsRemoving] = useState(false);
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    if (isAnimating) setShouldShow(true);
  }, [isAnimating]);

  if (!shouldShow && !isRemoving) return null;

  function handleRemoveClick() {
    setIsRemoving(true);
  }

  function handleRemoveComplete() {
    setShouldShow(false);
    setIsRemoving(false);
    onRemove?.();
  }

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          className="image-upload-card-drop-layer"
          initial={
            reduce
              ? { left: '50%', top: 'calc(50% - 0px)', x: '-50%', y: '-50%', opacity: 1 }
              : { left: '50%', top: '-300px', x: '-50%', y: 0, opacity: 1 }
          }
          animate={
            isRemoving
              ? {
                  scale: 0,
                  opacity: 0,
                  filter: 'blur(8px)',
                  transition: { duration: 0.4, ease: [0.23, 1, 0.32, 1] },
                }
              : reduce
                ? { left: '50%', top: 'calc(50% - 0px)', x: '-50%', y: '-50%', opacity: 1 }
                : {
                    // Vending machine drop — slow start, fast finish.
                    left: '50%',
                    top: 'calc(50% - 0px)',
                    x: '-50%',
                    y: '-50%',
                    opacity: 1,
                    transition: { duration: 1.2, ease: [0.55, 0.055, 0.675, 0.19] },
                  }
          }
          exit={{ scale: 0, opacity: 0, filter: 'blur(8px)', transition: { duration: 0.4, ease: [0.23, 1, 0.32, 1] } }}
          style={{ transformOrigin: 'center' }}
          onAnimationComplete={isRemoving ? handleRemoveComplete : onAnimationComplete}
        >
          <motion.div
            initial={{ scale: reduce ? 1 : 0.9 }}
            animate={
              isRemoving
                ? { scale: 0, transition: { duration: 0.4 } }
                : reduce
                  ? { scale: 1 }
                  : {
                      scale: 1.0,
                      transition: { type: 'spring', stiffness: 250, damping: 15, mass: 1.2, delay: 0.7 },
                    }
            }
            className="image-upload-card-preview"
          >
            <button type="button" onClick={handleRemoveClick} className="image-upload-card-remove" aria-label="Remove photo">
              <IconX width={12} height={12} />
            </button>
            <img src={previewUrl} alt="" className="image-upload-card-img" />
            {filename && (
              <div className="image-upload-card-filename">
                <span>{truncateFilename(filename)}</span>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// `onUpload(url, file)` gets both the local preview URL (for anything that
// just wants to show what was picked) and the real File (for a caller
// that defers its actual network upload until some later submit action,
// rather than uploading immediately on selection — see mobile/Quests.jsx's
// QuestPhotoSubmission for exactly that pattern). `onRemove()` fires once
// the X's exit animation finishes, not on click — a caller tracking its
// own copy of the file (again, QuestPhotoSubmission) needs to clear it in
// sync with the image actually leaving the frame, not a beat early.
export function ImageUploadCard({
  className,
  title = 'Upload a photo',
  description,
  accept = 'image/*',
  // Seeds the card as already holding an image — a caller that's editing
  // something which already has one (a profile picture, an org logo)
  // needs to show it immediately, not start from an empty drop zone every
  // time this mounts. `initialFileName` is cosmetic only (the filename
  // caption); there's no real File behind it, so removing/replacing this
  // seeded image never calls onUpload with one until a real file is
  // actually picked.
  initialPreviewUrl = null,
  initialFileName = null,
  onUpload,
  onRemove,
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnimating, setIsAnimating] = useState(Boolean(initialPreviewUrl));
  const [fileName, setFileName] = useState(initialFileName);
  const [previewUrl, setPreviewUrl] = useState(initialPreviewUrl);
  // Only true for a seeded initial image, and only matters once (the very
  // first mount, when the drop layer's own AnimatePresence child first
  // appears) — a pre-existing photo should just be *there*, not fall in
  // from above the moment this opens. Deliberately not reset back to
  // false later: once that first mount has happened, replacing the image
  // never re-mounts the drop layer anyway (see DroppedImage — shouldShow
  // only ever flips false->true once), so nothing later would read this
  // again regardless.
  const [skipInitialAnimation] = useState(Boolean(initialPreviewUrl));
  const previewRef = useRef(null);
  const fileInputRef = useRef(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const handleFile = useCallback(
    (file) => {
      if (!file || !file.type.startsWith('image/')) return;
      // Replacing an already-present image — dispose its URL before
      // handing out a new one, or the old blob leaks for the rest of the
      // session (revoking on remove/unmount alone doesn't cover this).
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);

      setIsAnimating(false);
      const url = URL.createObjectURL(file);
      previewRef.current = url;
      setPreviewUrl(url);
      setFileName(file.name);
      setIsUploading(true);

      // A brief simulated upload beat before the drop animation fires —
      // same shape as a real upload request, just fast, so the drop-in
      // always reads as "the file arrived," not "the file was already
      // there."
      setTimeout(() => {
        setIsUploading(false);
        setIsAnimating(true);
        onUpload?.(url, file);
      }, IMAGE_UPLOAD_SIMULATED_DELAY_MS);
    },
    [onUpload],
  );

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleFileChange = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleRemove = useCallback(() => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreviewUrl(null);
    setFileName(null);
    setIsAnimating(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onRemove?.();
  }, [onRemove]);

  const handleZoneClick = useCallback(() => {
    if (!isUploading && !previewUrl) fileInputRef.current?.click();
  }, [isUploading, previewUrl]);

  const hasImage = Boolean(previewUrl);

  return (
    <motion.div
      className={joinClassNames('image-upload-card', className)}
      initial={reduce ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      {/* Above the frame, not inside it — the drop layer's fall is measured
          relative to .image-upload-card-zone-wrap, and the mask just below
          only ever needs to cover the sliver of frame *above* that same
          zone-wrap. Keeping the title/description outside the frame
          entirely means neither of those has to change to accommodate
          copy that isn't part of the animation at all; putting it inside
          the frame (even reordered first) would just move the zone-wrap
          down without moving the mask's coverage down with it, leaving the
          falling image visible through that gap on its way in. */}
      {(title || description) && (
        <div className="image-upload-card-copy">
          {title && <h2>{title}</h2>}
          {description && <p>{description}</p>}
        </div>
      )}

      <div className="image-upload-card-frame">
        {/* Covers the drop layer until it reaches the zone below — without
            this, the image would visibly slide down across the frame's own
            rounded top edge during its entrance. */}
        <div className="image-upload-card-mask" />

        <div className="image-upload-card-body">
          <div
            className="image-upload-card-zone-wrap"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleZoneClick}
          >
            <div
              className={joinClassNames(
                'image-upload-card-zone',
                isUploading && 'is-uploading',
                isDragOver && 'is-drag-over',
              )}
            >
              {!hasImage && (
                <IconUpload
                  width={48}
                  height={48}
                  className={joinClassNames(
                    'image-upload-card-icon',
                    (isDragOver || isUploading) && 'is-active',
                  )}
                />
              )}
            </div>
            <div className="image-upload-card-border" data-uploading={isUploading} data-drag-over={isDragOver} />

            <DroppedImage
              isAnimating={isAnimating}
              onAnimationComplete={() => {}}
              filename={fileName}
              previewUrl={previewUrl}
              onRemove={handleRemove}
              reduce={reduce || skipInitialAnimation}
            />

            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
