export type Theme = 'dark' | 'light';

const THEME_KEY = 'walkcroach.theme.v1';

export function getStoredTheme(): Theme | null {
  const raw = localStorage.getItem(THEME_KEY);
  if (raw === 'light' || raw === 'dark') return raw;
  return null;
}

export function resolveTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return (
    getStoredTheme() ??
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}

export function initTheme(): Theme {
  const theme = resolveTheme();
  applyTheme(theme);
  return theme;
}
