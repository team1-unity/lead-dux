import { useEffect, useRef, useState } from 'react';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { storage } from './firebaseapp.jsx';

// Organizations' Community Photos gallery (org.photos, an array of Storage
// paths — see OrganizationProfile.jsx's OrgPhotoGallery, which this mirrors)
// as a hero carousel: auto-advances every 5s, no manual prev/next controls
// — anyone who wants to browse a specific photo already has the org's own
// profile page to do that at their own pace. Pressing and holding the
// photo pauses the advance (see pause/resume below) without adding real
// navigation; letting go just picks the timer back up. Falls back to the
// org's logo, then the brand placeholder illustration, whenever there are
// zero photos to show. Shared by the map quest detail (MapQuestDetailBody.jsx)
// and the Explore Quests detail (mobile/Quests.jsx's QuestDetailBody).
export function HeroCarousel({ photoPaths, orgLogoUrl }) {
  const [urls, setUrls] = useState([]);
  const [index, setIndex] = useState(0);
  // A ref, not state — read inside the interval's own tick (see below)
  // rather than driving a re-render/recreated timer every press/release.
  // The interval keeps running on its normal 5s cadence the whole time;
  // pausing just makes whichever ticks land while held no-op, so letting
  // go resumes on the same schedule rather than restarting a fresh 5s
  // window.
  const pausedRef = useRef(false);

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
    pausedRef.current = false;
    if (urls.length < 2) return undefined;
    const id = setInterval(() => {
      if (!pausedRef.current) setIndex((i) => (i + 1) % urls.length);
    }, 5000);
    return () => clearInterval(id);
  }, [urls.length]);

  // Holding a finger/mouse down on the photo itself pauses the advance —
  // someone reading a caption or just looking closer at one photo
  // shouldn't have it swapped out from under them mid-look. Pointer
  // events cover mouse and touch with the same handlers; Leave/Cancel
  // both resume too, so an accidental drag-off or an interrupted gesture
  // (e.g. a native back-swipe) never leaves this stuck paused forever.
  function pause() {
    pausedRef.current = true;
  }
  function resume() {
    pausedRef.current = false;
  }

  if (urls.length === 0) {
    return orgLogoUrl ? (
      <img src={orgLogoUrl} alt="" className="quest-hero-img" />
    ) : (
      <img src="/brand/placeholder.png" alt="" className="quest-hero-img" />
    );
  }

  return (
    <div
      className="quest-hero-carousel"
      onPointerDown={pause}
      onPointerUp={resume}
      onPointerLeave={resume}
      onPointerCancel={resume}
    >
      <div className="quest-hero-carousel-track" style={{ transform: `translateX(-${index * 100}%)` }}>
        {urls.map((url, i) => (
          <img key={i} src={url} alt="" className="quest-hero-img" />
        ))}
      </div>
    </div>
  );
}
