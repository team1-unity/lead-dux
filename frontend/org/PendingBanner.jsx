// Shown above the public interface for accounts with role "pendingorg" —
// their request is in, but no admin has approved it yet, so they see
// exactly what a public user sees, plus this notice.
export function PendingBanner() {
  return (
    <div className="box-warning">
      Your organization request is pending review by an admin. You'll get
      full organization access once it's approved — in the meantime, here's
      what a regular member sees.
    </div>
  );
}
