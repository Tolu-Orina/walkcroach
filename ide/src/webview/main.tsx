import { createRoot } from 'react-dom/client';
import './webview.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) {
  throw new Error('#root missing');
}

createRoot(root).render(<App />);
