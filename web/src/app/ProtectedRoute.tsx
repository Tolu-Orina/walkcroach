import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

type ProtectedRouteProps = {
  children: React.ReactNode;
  requireSignedIn?: boolean;
};

export function ProtectedRoute({
  children,
  requireSignedIn = false,
}: ProtectedRouteProps) {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="grid h-full place-items-center text-sm text-mist">Loading…</div>
    );
  }

  if (requireSignedIn && status !== 'authenticated') {
    return <Navigate to="/" replace />;
  }

  if (!requireSignedIn && status === 'anonymous' && !localStorage.getItem('walkcroach.auth.v1')) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
