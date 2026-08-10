import { useEffect, useState } from 'react';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { storage } from './firebaseapp.jsx';
import { DuckMark } from './Logo.jsx';

// `photoPaths` (a plain array of Storage paths/URLs) as a hero carousel:
// auto-advances every 5s, no manual controls at all — anyone who wants to
// linger on a specific photo already has the org's own profile page to
// browse its Community Photos gallery at their own pace. Callers pass in
// whatever mix of galleries is relevant (org.photos, a quest series'
// coverPhotos, or both — see MapQuestDetailBody.jsx and mobile/Quests.jsx's
// QuestDetailBody). Falls back to the org's logo, then the plain DuckMark
// placeholder, whenever there are zero photos to show.
export function HeroCarousel({ photoPaths, orgLogoUrl }) {
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
      <img src={orgLogoUrl} alt="" className="quest-hero-img" />
    ) : (
      <div className="quest-hero-fallback" aria-hidden="true">
        <DuckMark size={64} />
      </div>
    );
  }

  return (
    <div className="quest-hero-carousel">
      <div className="quest-hero-carousel-track" style={{ transform: `translateX(-${index * 100}%)` }}>
        {urls.map((url, i) => (
          <img key={i} src={url} alt="" className="quest-hero-img" />
        ))}
      </div>
    </div>
  );
}
