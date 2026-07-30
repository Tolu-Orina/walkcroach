import React from 'react';
import ReactDOM from 'react-dom/client';
// Graphite Lumen type — woff2-only @font-face rules, see fonts.css.
import './fonts.css';
import { App } from './App';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
