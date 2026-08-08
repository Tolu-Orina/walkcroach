import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './app/AppRoutes';
import { AuthProvider } from './auth/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary label="root">
          <div className="h-full min-h-0">
            <AppRoutes />
          </div>
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
}
