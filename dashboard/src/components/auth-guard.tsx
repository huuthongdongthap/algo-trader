/**
 * AuthGuard — redirects unauthenticated users to /login.
 * Wrap any /app/* route that requires a logged-in session.
 */
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth-store';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const loggedIn = useAuthStore((s) => s.loggedIn);
  if (!loggedIn) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
