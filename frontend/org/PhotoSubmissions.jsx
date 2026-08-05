import { useAuth } from '@shared/AuthContext.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { TopBar } from '@shared/TopBar.jsx';
import { PendingPhotoSubmissions } from '@shared/PendingPhotoSubmissions.jsx';
import { ApprovedPhotoSubmissions } from '@shared/ApprovedPhotoSubmissions.jsx';

// Full-page version of the review queue that used to sit inlined at the top
// of Dashboard.jsx — see PendingPhotoSubmissions.jsx for the actual
// grouped-by-quest UI, this is just the page shell. ApprovedPhotoSubmissions
// below it is a member's bonus-point photo, already approved, that the org
// can promote into its own public gallery (see add_submission_to_gallery).
export function PhotoSubmissions() {
  const { user } = useAuth();

  return (
    <PageMotion>
      {/* <TopBar title="Photo Submissions" /> */}
      <PendingPhotoSubmissions
        scopeField='orgId'
        scopeValue={user.uid}
        title='Pending photo submissions'
        allowGalleryKeep
      />
      <ApprovedPhotoSubmissions orgId={user.uid} />
    </PageMotion>
  );
}
