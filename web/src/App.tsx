import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './app/AppRoutes';
import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary label="root">
        <div className="h-full min-h-0">
          <AppRoutes />
        </div>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
