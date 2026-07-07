import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { AuthProvider, useAuth } from '@shared/AuthContext.jsx';
import { ProtectedRoute } from '@shared/ProtectedRoute.jsx';
import { db } from '@shared/firebaseapp.jsx';
import { Login } from './Login.jsx';
import { ForgotPassword } from './ForgotPassword.jsx';
import { ResetPassword } from './ResetPassword.jsx';
import { Register as RegisterPublic } from '@mobile/Register.jsx';
import { Onboarding } from '@mobile/Onboarding.jsx';
import { Quests } from '@mobile/Quests.jsx';
import { Register as RegisterOrganization } from '@org/Register.jsx';
import { Dashboard as OrgDashboard } from '@org/Dashboard.jsx';
import { PendingBanner } from '@org/PendingBanner.jsx';
import { Dashboard as AdminDashboard } from '@admin/Dashboard.jsx';
import '@shared/style.css';

// role is 'pendingorg' or absent (the public default) by the time this
// renders — Home below has already sent admin/organization elsewhere. Fetches
// the user's own profile doc to decide onboarding-form vs quest-list, and
// layers the pending banner on top for pendingorg accounts.
function PublicHome({ pending }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  function loadProfile() {
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      setProfile(snap.exists() ? snap.data() : null);
      setLoadingProfile(false);
    });
  }

  useEffect(loadProfile, [user]);

  if (loadingProfile) return <p>Loading...</p>;

  return (
    <>
      {pending && <PendingBanner />}
      {profile?.onboardingComplete ? (
        <Quests interests={profile.interests} />
      ) : (
        <Onboarding name={profile?.name} onComplete={loadProfile} />
      )}
    </>
  );
}

// The single place that decides, after auth, which interface someone
// belongs in. Login/Register pages never branch on role themselves — they
// just navigate('/') and let this sort it out.
function Home() {
  const { user, role, loading } = useAuth();

  if (loading) return <p>Loading...</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (role === 'admin') return <Navigate to="/admin" replace />;
  if (role === 'organization') return <Navigate to="/org" replace />;
  return <PublicHome pending={role === 'pendingorg'} />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<RegisterPublic />} />
          <Route path="/register/organization" element={<RegisterOrganization />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
