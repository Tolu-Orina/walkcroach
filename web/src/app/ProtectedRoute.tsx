import { Navigate, useLocation } from 'react-router-dom';
import { loadStoredAuth } from '../auth/storage';
import { useAuth } from '../auth/useAuth';
import { LoadingScreen } from '../components/LoadingScreen';

type ProtectedRouteProps = {
  children: React.ReactNode;
  requireSignedIn?: boolean;
};

export function ProtectedRoute({
  children,
  requireSignedIn = false,
}: ProtectedRouteProps) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <LoadingScreen />;
  }

  if (requireSignedIn && status !== 'authenticated') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/signin?next=${next}`} replace />;
  }

  if (!requireSignedIn && status === 'anonymous' && !loadStoredAuth()) {
    return <Navigate to="/signin" replace />;
  }

  return <>{children}</>;
}
