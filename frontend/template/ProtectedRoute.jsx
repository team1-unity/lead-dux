// Wraps a route that should only be reachable by a signed-in user with a
// specific role. Usage (react-router-dom):
//
//   <Route path="/admin" element={
//     <ProtectedRoute requiredRole="admin"><AdminDashboard /></ProtectedRoute>
//   } />
//
// Three states, deliberately distinct:
//   - still loading      -> spinner (don't guess yet, Firebase hasn't
//                           answered "who's logged in?" on page load)
//   - not logged in       -> redirect to /login
//   - logged in, wrong role -> an inline "not authorized" message, NOT a
//     redirect to /login. This guards *direct* URL access — e.g. someone
//     typing /admin into the address bar — since normal navigation after
//     login goes through Home (in App.jsx), which already sends people to
//     the section matching their role and never sends them here otherwise.
//     Redirecting to /login here would loop: they're already logged in, so
//     /login has nothing to do for them.

import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

export function ProtectedRoute({ requiredRole, children }) {
  const { user, role, loading } = useAuth();

  if (loading) {
    return <p>Loading...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (role !== requiredRole) {
    return (
      <p>
        You're signed in as "{role}", but this page requires "{requiredRole}".
        You don't have access to this app.
      </p>
    );
  }

  return children;
}
