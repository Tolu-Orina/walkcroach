import { useEffect, useState } from 'react';
import { applyTheme, getStoredTheme, type Theme } from '../lib/theme';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme() ?? 'dark');

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = () => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={`interactive btn-ghost text-xs ${className}`}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
