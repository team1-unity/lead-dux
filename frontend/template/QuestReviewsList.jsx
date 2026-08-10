import { useEffect, useState } from 'react';
import { callListQuestReviews } from './fetch.jsx';
import { OrgAvatar } from './OrgAvatar.jsx';
import { LoadingSpinner } from './LoadingSpinner.jsx';
import { formatEventDate } from './QuestSeriesRow.jsx';

// A row of 5 individually-colored stars (filled = brand mustard, empty =
// muted border color) — a Google-Maps-style two-tone star row for a
// single review's own rating, distinct from formatStars' plain ★/☆ text
// glyphs (QuestSeriesRow.jsx) used for the compact aggregate
// "★★★★☆ (12 reviews)" line elsewhere.
function StarRow({ rating }) {
  const whole = Math.round(rating);
  return (
    <span className="map-review-stars" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} aria-hidden="true" className={n <= whole ? 'map-review-star-filled' : 'map-review-star-empty'}>
          ★
        </span>
      ))}
    </span>
  );
}

// A quest's reviews, Google-Maps-style (one row per review: avatar, name,
// star row, date, body — see .map-review-* in style.css) — shared by the
// map quest detail (MapQuestDetailBody.jsx), the org's own quest dashboard
// (org/Quests.jsx), and the volunteer quest detail (mobile/Quests.jsx),
// all three of which show the exact same reviews for the exact same
// quest/series. Always rendered inline, no expand/collapse toggle — real
// Google Maps doesn't hide reviews behind a click either, and the fetch
// itself is cheap (one small Firestore subcollection read, no pagination).
//
// `reviewCount` (the series' own aggregate — every caller already has this
// via attachSeriesRatings) skips the fetch entirely when it's already
// known to be zero, rather than making a network request just to learn
// what the caller already knows. `null`/`undefined` (not explicitly 0)
// still fetches — only a confirmed zero short-circuits.
export function QuestReviewsList({ questId, reviewCount }) {
  const knownEmpty = reviewCount === 0;
  const [loading, setLoading] = useState(!knownEmpty);
  const [reviews, setReviews] = useState(knownEmpty ? [] : null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (reviewCount === 0) {
      setReviews([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    callListQuestReviews(questId)
      .then((data) => {
        if (!cancelled) {
          setReviews(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Could not load reviews.');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [questId, reviewCount]);

  if (loading) return <LoadingSpinner label="Loading reviews..." />;
  if (error) return <p className="box-danger">{error}</p>;
  if (reviews.length === 0) return <p className="field-optional">No reviews yet.</p>;

  return (
    <div className="map-reviews-list">
      {reviews.map((r) => (
        <div key={`${r.uid}-${r.eventDate}`} className="map-review-row">
          <div className="map-review-header">
            {/* No reviewer photo in this data (list_quest_reviews only
                returns uid/name/rating/body/dates) — reuses OrgAvatar with
                no logoUrl, so it just falls back to the duck. */}
            <div className="map-review-avatar">
              <OrgAvatar name={r.name || 'Unnamed'} seed={r.uid} />
            </div>
            <div className="map-review-header-text">
              <p className="map-review-name">{r.name || 'Unnamed'}</p>
              <div className="map-review-meta">
                <StarRow rating={r.rating} />
                {r.eventDate && <span className="map-review-date">{formatEventDate(r.eventDate)}</span>}
              </div>
            </div>
          </div>
          <p className="map-review-body">{r.body}</p>
        </div>
      ))}
    </div>
  );
}
