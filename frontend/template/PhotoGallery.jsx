import { useState } from 'react';
import { IconX } from './icons.jsx';
import { LightboxBackdrop } from './LightboxBackdrop.jsx';

// Reusable photo grid + lightbox, currently only fed an org's `photos`
// array (see OrganizationProfile) but deliberately generic — just an
// array of image URLs in, a grid + click-to-enlarge lightbox out. No
// upload/moderation UI here at all; that's a separate future feature. The
// point is that once approved attendee photos exist somewhere, populating
// this is just passing a longer array, not a rewrite.
export function PhotoGallery({ photos = [] }) {
  const [openIndex, setOpenIndex] = useState(null);

  if (photos.length === 0) {
    return <p className="data-stat">No photos yet — check back after the next event.</p>;
  }

  return (
    <>
      <div className="photo-gallery-grid">
        {photos.map((url, i) => (
          <button
            key={`${url}-${i}`}
            type="button"
            className="photo-gallery-thumb"
            onClick={() => setOpenIndex(i)}
            aria-label={`View photo ${i + 1} of ${photos.length}`}
          >
            <img src={url} alt="" loading="lazy" />
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <LightboxBackdrop onClose={() => setOpenIndex(null)} label="Photo">
          <div className="photo-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={photos[openIndex]} alt="" className="photo-lightbox-image" />
            <button
              type="button"
              className="photo-lightbox-close"
              onClick={() => setOpenIndex(null)}
              aria-label="Close"
            >
              <IconX width={18} height={18} />
            </button>
          </div>
        </LightboxBackdrop>
      )}
    </>
  );
}
