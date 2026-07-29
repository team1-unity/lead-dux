import { PageMotion } from '@shared/PageMotion.jsx';
import { PendingPhotoReview } from './PendingPhotoReview.jsx';

// Full-page version of the review queue that used to sit inlined at the top
// of Dashboard.jsx. This is now its own bento-grid/swipe-to-review
// component (PendingPhotoReview.jsx) rather than the shared
// PendingPhotoSubmissions.jsx — that one's still used as-is by the admin
// dashboard's side-quest review, deliberately left untouched; this page
// forked instead of parameterizing a second visual mode into the shared
// component.
export function PhotoSubmissions() {
  return (
    <PageMotion>
      <PendingPhotoReview />
    </PageMotion>
  );
}
