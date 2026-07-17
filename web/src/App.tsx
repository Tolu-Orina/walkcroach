import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './app/AppRoutes';

export default function App() {
  return (
    <BrowserRouter>
      <div className="h-full min-h-0">
        <AppRoutes />
      </div>
    </BrowserRouter>
  );
}
