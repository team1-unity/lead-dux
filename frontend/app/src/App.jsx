import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { AuthProvider, useAuth } from '@shared/AuthContext.jsx';
import { ProtectedRoute } from '@shared/ProtectedRoute.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { BottomNav } from '@shared/BottomNav.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { WelcomeTour } from '@shared/WelcomeTour.jsx';
import { RouteErrorBoundary } from '@shared/RouteErrorBoundary.jsx';
import { PreviousPathProvider } from '@shared/PreviousPathContext.jsx';
import { SmoothScroll } from '@shared/SmoothScroll.jsx';
import { PendingBanner } from '@org/PendingBanner.jsx';
import { OrgOnboarding } from '@org/OrgOnboarding.jsx';
import { SaveStatusToast } from '@shared/SaveStatusToast.jsx';
import { BackgroundMusic } from '@shared/BackgroundMusic.jsx';
import { getVolume } from '@shared/audioSettings.js';
import { Landing } from './Landing.jsx';
import '@shared/style.css';

// Route-level pages only, lazy — everything above this line is persistent
// chrome or needed to decide which route even renders, so it stays a
// regular eager import. Before this, App.jsx statically imported every
// route (including EventsMap's maplibre-gl and the admin Dashboard) into
// one bundle a signed-in "user" who never opens the map or isn't an admin
// still had to download before first paint. Each of these now becomes its
// own chunk, fetched only once its route is actually visited. Landing is
// deliberately NOT lazy — it's the first thing almost every signed-out
// visitor sees, so lazy-loading it would trade "download it eagerly" for
// "show a spinner, then download it," a worse cold-load experience for the
// single most common case rather than a better one.
const EventsMap = lazy(() => import('@shared/EventsMap.jsx').then((m) => ({ default: m.EventsMap })));
const Login = lazy(() => import('./Login.jsx').then((m) => ({ default: m.Login })));
const ForgotPassword = lazy(() => import('./ForgotPassword.jsx').then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import('./ResetPassword.jsx').then((m) => ({ default: m.ResetPassword })));
const Settings = lazy(() => import('./Settings.jsx').then((m) => ({ default: m.Settings })));
const Profile = lazy(() => import('./Profile.jsx').then((m) => ({ default: m.Profile })));
const CheckIn = lazy(() => import('./CheckIn.jsx').then((m) => ({ default: m.CheckIn })));
const CheckInConfirm = lazy(() => import('./CheckInConfirm.jsx').then((m) => ({ default: m.CheckInConfirm })));
const Certificate = lazy(() => import('./Certificate.jsx').then((m) => ({ default: m.Certificate })));
const OrganizationProfile = lazy(() =>
  import('./OrganizationProfile.jsx').then((m) => ({ default: m.OrganizationProfile })),
);
const QuestDetails = lazy(() => import('./QuestDetails.jsx').then((m) => ({ default: m.QuestDetails })));
const SharedQuest = lazy(() => import('./SharedQuest.jsx').then((m) => ({ default: m.SharedQuest })));
const DemoOrg = lazy(() => import('./DemoOrg.jsx').then((m) => ({ default: m.DemoOrg })));
const DemoStud = lazy(() => import('./DemoStud.jsx').then((m) => ({ default: m.DemoStud })));
const DemoOps = lazy(() => import('./DemoOps.jsx').then((m) => ({ default: m.DemoOps })));
const MapQuestPage = lazy(() => import('./MapQuestPage.jsx').then((m) => ({ default: m.MapQuestPage })));
const MapQuestOverlay = lazy(() => import('./MapQuestOverlay.jsx').then((m) => ({ default: m.MapQuestOverlay })));
const RegisterPublic = lazy(() => import('@mobile/Register.jsx').then((m) => ({ default: m.Register })));
const Onboarding = lazy(() => import('@mobile/Onboarding.jsx').then((m) => ({ default: m.Onboarding })));
const Quests = lazy(() => import('@mobile/Quests.jsx').then((m) => ({ default: m.Quests })));
const HomeScreen = lazy(() => import('@mobile/Home.jsx').then((m) => ({ default: m.Home })));
const Badges = lazy(() => import('@mobile/Badges.jsx').then((m) => ({ default: m.Badges })));
const Journal = lazy(() => import('@mobile/Journal.jsx').then((m) => ({ default: m.Journal })));
const RegisterOrganization = lazy(() => import('@org/Register.jsx').then((m) => ({ default: m.Register })));
const OrgHome = lazy(() => import('@org/Home.jsx').then((m) => ({ default: m.Home })));
const OrgQuests = lazy(() => import('@org/Quests.jsx').then((m) => ({ default: m.Quests })));
const OrgPhotoSubmissions = lazy(() =>
  import('@org/PhotoSubmissions.jsx').then((m) => ({ default: m.PhotoSubmissions })),
);
const OrgFeedbackRequests = lazy(() =>
  import('@org/FeedbackRequests.jsx').then((m) => ({ default: m.FeedbackRequests })),
);
const OrgJournal = lazy(() => import('@org/Journal.jsx').then((m) => ({ default: m.Journal })));
const AdminDashboard = lazy(() => import('@admin/Dashboard.jsx').then((m) => ({ default: m.Dashboard })));

// role is 'user' or 'pending_org' by the time this renders — Home below has
// already sent every other role elsewhere. onboarding_user renders the
// onboarding form directly (skipping the profile-driven branch below) since
// role, not a Firestore field, is now the source of truth for onboarding
// status. pending_org gets the same quest list as 'user' plus a banner.
function PublicHome({ role }) {
  const { user, refreshRole } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  function loadProfile() {
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      setProfile(snap.exists() ? snap.data() : null);
      setLoadingProfile(false);
    });
  }

  useEffect(loadProfile, [user]);

  if (loadingProfile) return <LoadingSpinner />;

  if (role === 'onboarding_user') {
    return (
      <Onboarding
        name={profile?.name}
        onComplete={async () => {
          // submit_onboarding just changed the claim to "user" server-side —
          // refresh the token so this switches to the quest list, then
          // reload the profile doc for the interests it just wrote.
          await refreshRole();
          loadProfile();
        }}
      />
    );
  }

  // `user` lands on the new Home dashboard (see mobile/Home.jsx) instead of
  // the quest feed directly — Quests moved to its own /quests route below.
  // `pending_org` isn't part of this redesign pass and still sees the quest
  // feed (with its banner) at "/", unchanged.
  return (
    <PageMotion>
      {role === 'pending_org' && <PendingBanner />}
      {role === 'user' ? (
        <HomeScreen />
      ) : (
        <Quests
          interests={profile?.interests || []}
          name={profile?.name}
          recommendedQuestOrder={profile?.recommendedQuestOrder}
          attendedTagCounts={profile?.attendedTagCounts}
        />
      )}
    </PageMotion>
  );
}

// The standalone Quests destination for `user` (see BottomNav's
// PRIMARY_BY_ROLE.user) — same component, same props PublicHome used to
// render inline before Home took over "/". Reloads its own profile fields
// independently rather than threading them through a route param, same
// shape as PublicHome's own fetch above.
function QuestsPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      setProfile(snap.exists() ? snap.data() : null);
    });
  }, [user]);

  if (!profile) return <LoadingSpinner />;

  return (
    <PageMotion>
      <Quests
        interests={profile.interests || []}
        name={profile.name}
        recommendedQuestOrder={profile.recommendedQuestOrder}
        attendedTagCounts={profile.attendedTagCounts}
      />
    </PageMotion>
  );
}

// Admin sees the same quest list a normal user does; BottomNav's "Data" tab
// is the way to the admin-only data page (user/org/quest management).
function AdminHome() {
  return (
    <PageMotion>
      <Quests interests={[]} />
    </PageMotion>
  );
}

// The single place that decides, after auth, which interface someone
// belongs in. Login/Register pages never branch on role themselves — they
// just navigate('/') and let this sort it out. A signed-out visitor gets
// the marketing Landing page here instead of bouncing straight to /login —
// "/" is the actual front door, not a redirect.
function Home() {
  const { user, role, loading } = useAuth();

  if (loading) return <LoadingSpinner />;
  if (!user) return <Landing />;
  if (role === 'organization') return <Navigate to="/org" replace />;
  // Declared org intent but hasn't submitted the org-details form yet —
  // send them back to finish it instead of showing the quest list.
  if (role === 'onboarding_org') return <Navigate to="/register/organization" replace />;
  if (role === 'admin') return <AdminHome />;
  return <PublicHome role={role} />;
}

// Persistent chrome for every signed-in app page (as opposed to auth
// screens, which get none). Rendered once at the router layout level, as a
// sibling of <Outlet/> rather than inside each page — react-router keeps
// this component instance mounted across navigations between its child
// routes, so BottomNav no longer unmounts/remounts (and visibly jumps)
// every time PageMotion replays a page's own mount animation.
//
// showNav is deliberately keyed on the URL, not on `role` — the only two
// states that shouldn't see nav (the signed-out Landing page and the
// Onboarding form) both render in place of the quest feed at "/" (see
// Home/PublicHome above), so "/" is the one path that still needs to ask
// role. Every other path shows nav unconditionally: if role is momentarily
// unresolved, stale, or a page below has an issue, that's exactly when a
// way out matters most, so nav no longer disappears along with it. The
// actual page content is also wrapped in an error boundary (not BottomNav)
// so an uncaught error in one page can't take the nav down with it either.
function AppShell() {
  const { role } = useAuth();
  const location = useLocation();
  const showNav = location.pathname !== '/' || (role && role !== 'onboarding_user');

  // Tracks the full path (pathname + search) one hop back, for Settings/
  // Badges/quest-detail's dynamic "Back to X" link (see
  // PreviousPathContext.jsx) — includes the query string, not just the
  // route, so a caller that reflects filter/search state in its own URL
  // (see mobile/Quests.jsx) gets that state back too on the way in, not
  // just the bare route. A layout effect, not a plain effect — it fires
  // synchronously before paint, so the corrected value is in place before
  // the browser ever shows a frame, rather than flashing a stale
  // one-hop-further-back path for a frame first.
  const [previousPath, setPreviousPath] = useState(null);
  const fullPath = location.pathname + location.search;
  const currentPathRef = useRef(fullPath);
  useLayoutEffect(() => {
    if (currentPathRef.current !== fullPath) {
      setPreviousPath(currentPathRef.current);
      currentPathRef.current = fullPath;
    }
  }, [fullPath]);

  return (
    <PreviousPathProvider value={previousPath}>
      <RouteErrorBoundary resetKey={location.pathname}>
        {/* Its own boundary, not just the outer one AppRoutes wraps
            everything in below — lazy page chunks now suspend here, and
            nesting this Suspense inside AppShell (rather than relying on
            that outer one) means BottomNav/WelcomeTour/OrgOnboarding stay
            mounted and visible while a route's chunk loads, instead of the
            whole shell (nav included) disappearing behind the fallback. */}
        <Suspense fallback={<LoadingSpinner />}>
          <Outlet />
        </Suspense>
      </RouteErrorBoundary>
      {showNav && <BottomNav />}
      <WelcomeTour />
      <OrgOnboarding />
      <SaveStatusToast />
    </PreviousPathProvider>
  );
}

// Route tree lives here (rather than directly in App below) so it can call
// useLocation() — needed for the "background location" pattern that gives
// /map/:seriesId two different renders depending on how it was reached: a
// row/pin clicked from within /map (EventsMap.jsx) navigates here with
// state.backgroundLocation set to a fixed "/map" location, so the PRIMARY
// <Routes> below keeps matching/rendering EventsMap (unchanged, still
// panned/zoomed where it was) while a SECOND, overlay-only <Routes>
// (matched against the real, current location — no override) renders
// MapQuestOverlay.jsx floating on top of it. A direct load of the same URL
// (a shared link, a refresh, no backgroundLocation state to fall back on)
// has nothing to override the primary Routes with, so it matches
// /map/:seriesId there instead and renders MapQuestPage.jsx, the full
// standalone page — the graceful fallback the whole point of this pattern
// is to guarantee. See EventsMap.jsx's own MAP_BACKGROUND_LOCATION and
// MapQuestOverlay.jsx for the other two pieces of this.
function AppRoutes() {
  const location = useLocation();
  const backgroundLocation = location.state?.backgroundLocation;

  // A global click sound — everywhere except the org side (an org's own
  // workspace, not the game-like member experience this sound belongs to)
  // and the Home duck mascot (which already plays its own quack — see
  // InteractiveMascot.jsx's data-no-click-sound, mobile/Home.jsx's
  // playQuack). Kept as a ref rather than a `location.pathname` effect
  // dependency so the listener itself is only ever attached once; the ref
  // is what stays current across navigations instead. A fresh Audio
  // instance per click, same reasoning as playQuack — lets rapid clicks
  // overlap instead of the next one cutting off whatever's still playing.
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;
  useEffect(() => {
    function onClick(e) {
      if (pathnameRef.current.startsWith('/org')) return;
      if (e.target.closest?.('[data-no-click-sound]')) return;
      const volume = getVolume('clicks');
      if (volume <= 0) return;
      const audio = new Audio('/audio/mouse-click.mp3');
      audio.volume = volume;
      audio.play().catch(() => {});
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return (
    // Covers the routes below that render outside AppShell (Login,
    // Register, the /share and /check-in links) — those have no
    // persistent chrome of their own to preserve, so one boundary here is
    // enough for them. AppShell's own routes are already covered by the
    // narrower Suspense around its <Outlet/> above, which takes
    // precedence for anything suspending in that subtree; this one is
    // just the fallback for everything that isn't nested inside it.
    <Suspense fallback={<LoadingSpinner />}>
      <Routes location={backgroundLocation || location}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<RegisterPublic />} />
        <Route path="/register/organization" element={<RegisterOrganization />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        {/* Deliberately outside AppShell — this is the one quest page that
            has to work for a fully signed-out visitor (a share link
            clicked from outside the app), so it can't sit behind the
            same tree as routes that assume an authenticated role. A map
            quest's own Share action reuses this exact link too (see
            MapQuestDetailBody.jsx) rather than a second, map-flavored
            share page — one shareable link per quest, not two. */}
        <Route path="/share/:seriesId" element={<SharedQuest />} />
        {/* Always-works-for-a-presentation demo routes (see
            functions/main.py's "Demo showcase" section) — deliberately
            outside AppShell, same as /share above: no login, no role
            check, nothing that can fail on stale auth state mid-demo.
            /demo-org and /demo-stud sign the visitor into a fixed demo
            account and immediately redirect into the real /org or /
            experience (see those files) — they render nothing of their
            own past a brief loading state. /demo-ops is the presenter's
            own backstage control screen and never signs in as anyone. */}
        <Route path="/demo-org" element={<DemoOrg />} />
        <Route path="/demo-stud" element={<DemoStud />} />
        <Route path="/demo-ops" element={<DemoOps />} />
        {/* Deliberately outside AppShell too, same reasoning as /share
            above — an event QR's own URL (see functions/main.py's
            _check_in_url) has to work the moment it's scanned with a
            phone's native camera app, not just from inside this app's own
            nav chrome. Unlike /share, this one does require signing in
            (check_in_to_event itself requires auth) — CheckInConfirm.jsx
            handles that itself with a plain "log in, then scan again"
            prompt rather than a redirect-back-after-login flow, since the
            QR is a durable, reusable link either way. */}
        <Route path="/check-in/:questId/:token" element={<CheckInConfirm />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<Home />} />
          <Route path="/quests" element={<QuestsPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/check-in" element={<CheckIn />} />
          <Route path="/certificate" element={<Certificate />} />
          <Route path="/organizations/:orgId" element={<OrganizationProfile />} />
          <Route path="/quests/:seriesId" element={<QuestDetails />} />
          <Route path="/badges" element={<Badges />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/map" element={<EventsMap />} />
          <Route path="/map/:seriesId" element={<MapQuestPage />} />
          <Route
            path="/admin"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/org"
            element={
              <ProtectedRoute requiredRole="organization">
                <OrgHome />
              </ProtectedRoute>
            }
          />
          <Route
            path="/org/quests"
            element={
              <ProtectedRoute requiredRole="organization">
                <OrgQuests />
              </ProtectedRoute>
            }
          />
          <Route
            path="/org/photo-submissions"
            element={
              <ProtectedRoute requiredRole="organization">
                <OrgPhotoSubmissions />
              </ProtectedRoute>
            }
          />
          <Route
            path="/org/feedback-requests"
            element={
              <ProtectedRoute requiredRole="organization">
                <OrgFeedbackRequests />
              </ProtectedRoute>
            }
          />
          {/* No longer linked from nav (see BottomNav's
              FEATURES_BY_ROLE.organization) — the host-reflection
              feature itself still exists, just isn't a primary flow
              anymore. Route stays so it's still reachable directly. */}
          <Route
            path="/org/journal"
            element={
              <ProtectedRoute requiredRole="organization">
                <OrgJournal />
              </ProtectedRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {backgroundLocation && (
        <Routes>
          <Route path="/map/:seriesId" element={<MapQuestOverlay />} />
        </Routes>
      )}
    </Suspense>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <SmoothScroll />
        {/* A sibling of AppRoutes, not nested inside it — never sits behind
            any route-switching subtree, so navigating never remounts it
            (see BackgroundMusic.jsx's own module note for the belt-and-
            suspenders reason its actual <audio> is a plain singleton on
            top of that). */}
        <BackgroundMusic />
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
