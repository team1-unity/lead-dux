import { useAuth } from '@shared/AuthContext.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { ApprovedPhotoSubmissions } from '@shared/ApprovedPhotoSubmissions.jsx';
import { PendingPhotoReview } from './PendingPhotoReview.jsx';

// Full-page version of the review queue that used to sit inlined at the top
// of Dashboard.jsx. The pending queue is PendingPhotoReview.jsx's own
// bento-grid + swipe-to-approve/disapprove flow (not a rework of
// frontend/template/PendingPhotoSubmissions.jsx, which stays exactly as-is
// for the admin dashboard's side-quest review — that one was briefly
// swapped in here in its place, which is what this restores). Approve
// there doesn't add straight to the gallery (see PendingPhotoReview.jsx's
// own approvePhoto — it doesn't pass addToGallery), so ApprovedPhotoSubmissions
// below it is where those approved-but-not-yet-added photos actually get
// promoted into the org's public gallery (see add_submission_to_gallery).
export function PhotoSubmissions() {
  const { user } = useAuth();

  return (
    <PageMotion>
      <PendingPhotoReview />
      <ApprovedPhotoSubmissions orgId={user.uid} />
    </PageMotion>
  );
}
