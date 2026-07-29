import { useAuth } from '@shared/AuthContext.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { PendingFeedbackList } from './PendingFeedbackList.jsx';

// Pending queue only (see PendingFeedbackList.jsx/FeedbackRequestPanel.jsx —
// list + inline step-through rating flow). Used to also show a read-only
// history of feedback already given, removed by request; Journal itself
// still exists at /org/journal, just no longer linked from nav.
export function FeedbackRequests() {
  const { user } = useAuth();

  return (
    <PageMotion>
      <PendingFeedbackList orgId={user.uid} title='Pending feedback requests' />
    </PageMotion>
  );
}
