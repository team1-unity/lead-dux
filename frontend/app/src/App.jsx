import { useEffect, useState } from 'react';
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
import { SmoothScroll } from '@shared/SmoothScroll.jsx';
import { EventsMap } from '@shared/EventsMap.jsx';
import { Landing } from './Landing.jsx';
import { Login } from './Login.jsx';
import { ForgotPassword } from './ForgotPassword.jsx';
import { ResetPassword } from './ResetPassword.jsx';
import { Settings } from './Settings.jsx';
import { Profile } from './Profile.jsx';
import { CheckIn } from './CheckIn.jsx';
import { Certificate } from './Certificate.jsx';
import { OrganizationProfile } from './OrganizationProfile.jsx';
import { QuestDetails } from './QuestDetails.jsx';
import { SharedQuest } from './SharedQuest.jsx';
import { MapQuestPage } from './MapQuestPage.jsx';
import { MapQuestOverlay } from './MapQuestOverlay.jsx';
import { Register as RegisterPublic } from '@mobile/Register.jsx';
import { Onboarding } from '@mobile/Onboarding.jsx';
import { Quests } from '@mobile/Quests.jsx';
import { Home as HomeScreen } from '@mobile/Home.jsx';
import { Badges } from '@mobile/Badges.jsx';
import { Journal } from '@mobile/Journal.jsx';
import { Register as RegisterOrganization } from '@org/Register.jsx';
import { Home as OrgHome } from '@org/Home.jsx';
import { Quests as OrgQuests } from '@org/Quests.jsx';
import { PhotoSubmissions as OrgPhotoSubmissions } from '@org/PhotoSubmissions.jsx';
import { FeedbackRequests as OrgFeedbackRequests } from '@org/FeedbackRequests.jsx';
import { Journal as OrgJournal } from '@org/Journal.jsx';
import { PendingBanner } from '@org/PendingBanner.jsx';
import { Dashboard as AdminDashboard } from '@admin/Dashboard.jsx';
import '@shared/style.css';

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
  return (
    <>
      <RouteErrorBoundary resetKey={location.pathname}>
        <Outlet />
      </RouteErrorBoundary>
      {showNav && <BottomNav />}
      <WelcomeTour />
    </>
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

  return (
    <>
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
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <SmoothScroll />
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
