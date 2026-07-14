import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { AuthProvider, useAuth } from '@shared/AuthContext.jsx';
import { ProtectedRoute } from '@shared/ProtectedRoute.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { TopBar } from '@shared/TopBar.jsx';
import { BottomNav } from '@shared/BottomNav.jsx';
import { AmbientParticles } from '@shared/AmbientParticles.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { Landing } from './Landing.jsx';
import { Login } from './Login.jsx';
import { ForgotPassword } from './ForgotPassword.jsx';
import { ResetPassword } from './ResetPassword.jsx';
import { Settings } from './Settings.jsx';
import { Profile } from './Profile.jsx';
import { Register as RegisterPublic } from '@mobile/Register.jsx';
import { Onboarding } from '@mobile/Onboarding.jsx';
import { Quests } from '@mobile/Quests.jsx';
import { Register as RegisterOrganization } from '@org/Register.jsx';
import { Dashboard as OrgDashboard } from '@org/Dashboard.jsx';
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

  return (
    <PageMotion>
      <AmbientParticles />
      <TopBar />
      {role === 'pending_org' && <PendingBanner />}
      <Quests interests={profile?.interests || []} />
    </PageMotion>
  );
}

// Admin sees the same quest list a normal user does; BottomNav's "Data" tab
// is the way to the admin-only data page (user/org/quest management).
function AdminHome() {
  return (
    <PageMotion>
      <AmbientParticles />
      <TopBar />
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
// every time PageMotion replays a page's own mount animation. onboarding_user
// is the one signed-in state that shouldn't see nav yet (Home renders the
// Onboarding form in its place at "/").
function AppShell() {
  const { role } = useAuth();
  const showNav = role && role !== 'onboarding_user';
  return (
    <>
      <Outlet />
      {showNav && <BottomNav />}
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<RegisterPublic />} />
          <Route path="/register/organization" element={<RegisterOrganization />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<Home />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/profile" element={<Profile />} />
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
                  <OrgDashboard />
                </ProtectedRoute>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
