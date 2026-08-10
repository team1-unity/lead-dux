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
      {/* Every submission here is for one of this org's own (non-default)
          quests — a member can only submit one after already checking in
          via QR (see submit_quest_photo's own note in functions/main.py),
          so approving never creates or backdates attendance; it's purely
          the flat +5 bonus on top of a quest that's already complete. */}
      <p className='field-optional' style={{ marginTop: -8, marginBottom: 16 }}>
        These are optional bonus photos — everyone here already checked in with the QR code.
        Approving adds +5 points; it doesn't change attendance.
      </p>
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
