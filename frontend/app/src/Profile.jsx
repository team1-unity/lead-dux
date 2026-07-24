import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { useAuth } from '@shared/AuthContext.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { StatusStamp } from '@shared/StatusStamp.jsx';
import { DuckMark } from '@shared/Logo.jsx';
import { groupBySeries, isUpcoming } from '@shared/questSeries.js';
import { IconCheck, IconChevron, IconLock, IconGear } from '@shared/icons.jsx';
import { allRanks, pointsToNextRank, progressPercent, rankForPoints } from '@shared/rank.js';
import { computeBadges } from '@shared/badges.js';
import { BadgeRing } from '@mobile/Badges.jsx';

// Points/rank/certificateIssued are read straight off the user's own doc
// (self-readable, see firestore.rules) — no dedicated Cloud Function needed
// just to display them; get_user_rank exists for the admin dashboard to
// look up someone ELSE's rank instead. Rank itself IS now stored
// server-side (kept in sync by functions/main.py's _award_points) so it can
// be queried across users (see list_diamond_users) — see rank.js for why
// it's still recomputed here too rather than trusted blindly.
// Collapsed by default (matching the wireframe's chevron) — showing just
// the rank name so Profile doesn't open with a full page of milestones;
// expanding reveals the exact same detail this card always rendered.
function ProgressCard() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      const data = snap.exists() ? snap.data() : {};
      setProfile({ points: data.points || 0, certificateIssued: Boolean(data.certificateIssued) });
    });
  }, [user]);

  if (profile === null) return null;

  const { points, certificateIssued } = profile;
  const rank = rankForPoints(points);
  const toNext = pointsToNextRank(points);
  const percent = progressPercent(points);
  const rankOrder = allRanks();
  const currentIndex = rankOrder.indexOf(rank);

  return (
    <section className="ink-card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        className="quest-card-head"
        style={{ padding: 0 }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="quest-card-titles">
          <h2 style={{ marginBottom: 0 }}>Leadership Rank</h2>
          <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.4rem', textTransform: 'uppercase' }}>
            {rank}
          </p>
        </div>
        <IconChevron className="quest-chevron" data-open={open ? 'true' : 'false'} />
      </button>

      {open && (
        <>
          <p className="data-stat" style={{ marginTop: 4 }}>
            {points} point{points === 1 ? '' : 's'}
            {toNext !== null ? ` — ${toNext} to ${rankForPoints(points + toNext)}` : ' — top rank reached'}
          </p>

          <div className="rank-progress-track" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
            <div className="rank-progress-fill" style={{ width: `${percent}%` }} />
          </div>

          <div className="rank-milestones">
            {rankOrder.map((name, i) => {
              const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'locked';
              const tone = name.toLowerCase();
              return (
                <div className="rank-milestone" key={name} data-state={state}>
                  <span
                    className="rank-milestone-dot"
                    style={{ '--rank-color': `var(--rank-${tone})`, '--rank-ink': `var(--rank-${tone}-ink)` }}
                  >
                    {state === 'done' && <IconCheck width={14} height={14} />}
                    {state === 'locked' && <IconLock width={14} height={12} />}
                  </span>
                  <span className="rank-milestone-label">{name}</span>
                </div>
              );
            })}
          </div>

          {certificateIssued && (
            <div className="rank-certificate-banner">
              <p style={{ margin: 0 }}>You&rsquo;ve been awarded a Diamond leadership certificate!</p>
              <Link to="/certificate">
                <StampButton type="button" variant="primary">View certificate</StampButton>
              </Link>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// A quick glimpse of quests the caller is RSVP'd to — the full list (with
// cancel/manage actions) still lives on Quests itself; tapping through here
// just pre-filters that page via ?mine=1 (see Quests.jsx's `mineOnly`)
// rather than duplicating any of that UI on Profile.
function RsvpdQuestsPreview() {
  const { user } = useAuth();
  const [series, setSeries] = useState(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getDocs(query(collection(db, 'quests'), where('rsvpd', 'array-contains', user.uid))).then((snap) => {
      if (cancelled) return;
      const quests = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(isUpcoming);
      setSeries(groupBySeries(quests));
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (series === null) return null;

  return (
    <section className="ink-card">
      <div className="flex justify-between items-center">
        <div>
          <h2 style={{ margin: 0 }}>RSVP&rsquo;d Quests</h2>
          <p className="data-stat" style={{ marginTop: 4 }}>
            {series.length === 0 ? 'No upcoming RSVPs yet' : `${series.length} upcoming`}
          </p>
        </div>
        <Link to="/quests?mine=1" aria-label="View all RSVP'd quests">
          <IconChevron style={{ transform: 'rotate(-90deg)' }} />
        </Link>
      </div>
      {series.length > 0 && (
        <ul className="data-sublist" style={{ marginTop: 10 }}>
          {series.slice(0, 3).map((s) => (
            <li key={s.seriesId}>{s.primary.title}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

// A quick glimpse of earned badges — the full grid (with in-progress/
// undiscovered sections) lives on the existing Badges page (see
// mobile/Badges.jsx, which now exports BadgeRing for this reuse); tapping
// through here goes straight there rather than re-implementing that page.
function BadgesPreview() {
  const { user } = useAuth();
  const [earned, setEarned] = useState(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([
      getDocs(collection(db, 'quests')),
      getDocs(query(collection(db, 'attendance'), where('userId', '==', user.uid))),
      getDoc(doc(db, 'users', user.uid)),
    ]).then(([questsSnap, attendanceSnap, userSnap]) => {
      if (cancelled) return;
      const questsById = new Map(questsSnap.docs.map((d) => [d.id, d.data()]));
      const attendance = attendanceSnap.docs.map((d) => d.data());
      const userData = userSnap.exists() ? userSnap.data() : {};
      const computed = computeBadges({ attendance, questsById, rank: userData.rank, createdAt: userData.createdAt });
      setEarned(computed.filter((b) => b.earned));
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (earned === null) return null;

  return (
    <section className="ink-card">
      <div className="flex justify-between items-center">
        <div>
          <h2 style={{ margin: 0 }}>All Badges</h2>
          <p className="data-stat" style={{ marginTop: 4 }}>
            {earned.length === 0 ? 'No badges earned yet' : `${earned.length} earned`}
          </p>
        </div>
        <Link to="/badges" aria-label="View all badges">
          <IconChevron style={{ transform: 'rotate(-90deg)' }} />
        </Link>
      </div>
      {earned.length > 0 && (
        <div className="profile-preview-badges" style={{ marginTop: 10 }}>
          {earned.slice(0, 6).map((b) => (
            <BadgeRing key={b.id} badge={b} size={56} />
          ))}
        </div>
      )}
    </section>
  );
}

// No profile photo upload exists in this app (users have no avatar field) —
// the duck mascot in a brand-mustard ring is the deliberate placeholder for
// every account, rather than an initial-based tile (which would make this
// read like an org's avatar, a color-per-entity system that doesn't fit a
// personal profile).
function UserAvatar() {
  return (
    <div className="user-avatar" aria-hidden="true">
      <DuckMark size={40} />
    </div>
  );
}

// The "your account" hub: identity, rank progress/RSVPs/badges (role "user"
// only), and wherever the caller stands in the organization-registration
// flow. Settings, by contrast, is interests/accessibility, display
// preferences, account deletion, and now signing out too (see
// Settings.jsx) — this split keeps "things about me" (who I am, what I've
// done) separate from "things I'd tweak," reached from here via the gear
// icon. Organizations now sign up directly from the landing page rather
// than converting from a regular user account, so there's no "become an
// organization" prompt here anymore — only the four states a caller
// already in that pipeline (or already an org/admin) can be in.
export function Profile() {
  const { user, role, loading } = useAuth();
  const [name, setName] = useState(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      setName(snap.exists() ? snap.data().name || '' : '');
    });
  }, [user]);

  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <PageMotion>
      <div className="profile-identity">
        <UserAvatar />
        <div className="profile-identity-info">
          <h1>{name || 'Your profile'}</h1>
          <p className="profile-meta">Signed in as {user.email}</p>
        </div>
        <Link to="/settings" className="profile-settings-link" aria-label="Settings" title="Settings">
          <IconGear />
        </Link>
      </div>

      {role === 'user' && (
        <div className="flex gap-sm" style={{ marginBottom: 16 }}>
          {/* No backend support yet for a user renaming/editing their own
              identity fields (unlike interests/accessibility, which do have
              one) — placeholder for now, same treatment as Quests' "Sort
              by" pill, matching the wireframe's button next to Scan QR
              Code. */}
          <StampButton type="button" disabled title="Coming soon" style={{ flex: 1 }}>
            Edit Profile
          </StampButton>
          <Link to="/check-in" style={{ flex: 1 }}>
            <StampButton type="button" style={{ width: '100%' }}>
              Scan QR Code
            </StampButton>
          </Link>
        </div>
      )}

      <div className="profile-grid">
        {role === 'user' && <ProgressCard />}
        {role === 'user' && <RsvpdQuestsPreview />}
        {role === 'user' && <BadgesPreview />}

        {role !== 'user' && (
          <section className="ink-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ marginBottom: 0 }}>Organization</h2>

            {role === 'onboarding_org' && (
              <div className="flex justify-between items-center">
                <div>
                  <StatusStamp muted>IN PROGRESS</StatusStamp>
                  <p style={{ margin: '8px 0 0' }}>You started registering an organization.</p>
                </div>
                <Link to="/register/organization" aria-label="Finish your application">
                  <IconChevron style={{ transform: 'rotate(-90deg)' }} />
                </Link>
              </div>
            )}

            {role === 'pending_org' && (
              <div>
                <StatusStamp tone="outdoors">UNDER REVIEW</StatusStamp>
                <p style={{ margin: '8px 0 0' }}>Your organization application is awaiting admin review.</p>
              </div>
            )}

            {role === 'organization' && (
              <div className="flex justify-between items-center">
                <div>
                  <StatusStamp tone="education">APPROVED</StatusStamp>
                  <p style={{ margin: '8px 0 0' }}>You already manage an organization.</p>
                </div>
                <Link to="/org" aria-label="Go to your organization home">
                  <IconChevron style={{ transform: 'rotate(-90deg)' }} />
                </Link>
              </div>
            )}

            {role === 'admin' && (
              <div>
                <StatusStamp tone="community">FULL ACCESS</StatusStamp>
                <p style={{ margin: '8px 0 0' }}>
                  You manage the whole platform from the <Link to="/admin">admin data page</Link>.
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </PageMotion>
  );
}
