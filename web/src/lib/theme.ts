export type Theme = 'dark' | 'light';

const THEME_KEY = 'walkcroach.theme.v1';

export function getStoredTheme(): Theme | null {
  const raw = localStorage.getItem(THEME_KEY);
  if (raw === 'light' || raw === 'dark') return raw;
  return null;
}

export function resolveTheme(): Theme {
  return getStoredTheme() ?? 'dark';
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
