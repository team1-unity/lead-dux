import { StatusStamp } from './StatusStamp.jsx';

// The org-level Trust Score is never shown to members as a number — only
// one of three tags next to the org's name (see AI_README.md's
// "Organization Trust Score" and _trust_status in functions/main.py):
//   - 'new': not enough reviews yet to judge either way.
//   - 'trustworthy': cleared TRUST_SCORE_TAG_THRESHOLD.
//   - 'under_review': settled at or below TRUST_SCORE_FLAG_THRESHOLD — a
//     warning that this org's ratings have been low enough to flag.
// Anything else (enough reviews, but neither clearly good nor clearly bad)
// renders nothing at all.
export function TrustTag({ status }) {
  if (status === 'new') {
    return <StatusStamp muted>New Organization</StatusStamp>;
  }
  if (status === 'trustworthy') {
    return <StatusStamp tone="environment">Trustworthy</StatusStamp>;
  }
  if (status === 'under_review') {
    return (
      <span className="status-stamp" style={{ '--tag-color': 'var(--danger)' }}>
        Under Review
      </span>
    );
  }
  return null;
}
