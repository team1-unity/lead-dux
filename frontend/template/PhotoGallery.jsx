import { useState } from 'react';
import { IconX } from './icons.jsx';
import { LightboxBackdrop } from './LightboxBackdrop.jsx';

// Reusable photo grid + lightbox, currently only fed an org's `photos`
// array (see OrganizationProfile) but deliberately generic — just an
// array of image URLs in, a grid + click-to-enlarge lightbox out. No
// upload UI here at all; that lives in OrganizationProfile.jsx itself
// (upload is org-specific — this component stays generic). `onDelete`, if
// passed, is the one exception: a small × overlay on each thumbnail,
// enough for the one caller (the gallery's own owner) that needs removal
// without this otherwise-read-only component knowing anything about who's
// allowed to call it.
export function PhotoGallery({ photos = [], onDelete, className }) {
  const [openIndex, setOpenIndex] = useState(null);

  if (photos.length === 0) {
    return <p className="data-stat">No photos yet — the next event will start the gallery.</p>;
  }

  return (
    <>
      <div className={className ? `photo-gallery-grid ${className}` : 'photo-gallery-grid'}>
        {photos.map((url, i) => (
          <div key={`${url}-${i}`} className="photo-gallery-thumb-wrap">
            <button
              type="button"
              className="photo-gallery-thumb"
              onClick={() => setOpenIndex(i)}
              aria-label={`View photo ${i + 1} of ${photos.length}`}
            >
              <img src={url} alt="" loading="lazy" />
            </button>
            {onDelete && (
              <button
                type="button"
                className="photo-gallery-thumb-delete"
                onClick={() => onDelete(i)}
                aria-label={`Remove photo ${i + 1}`}
                title="Remove"
              >
                <IconX width={14} height={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {openIndex !== null && (
        <LightboxBackdrop onClose={() => setOpenIndex(null)} label="Photo">
          <div className="photo-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={photos[openIndex]} alt="" className="photo-lightbox-image" />
          </div>
        </LightboxBackdrop>
      )}
    </>
  );
}
