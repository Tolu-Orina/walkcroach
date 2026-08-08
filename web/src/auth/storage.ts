import type { AuthUser } from './types';

export const AUTH_STORAGE_KEY = 'walkcroach.auth.v1';

export type StoredAuth = {
  user: AuthUser;
  token: string;
  cognito?: {
    idToken: string;
    /** Cognito access token — used by Chrome/IDE paste/upgrade paths. */
    accessToken?: string;
    refreshToken: string;
    expiresAt: number;
  };
};

export function loadStoredAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

export function persistAuth(stored: StoredAuth): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(stored));
}

export function clearStoredAuth(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

/**
 * Clear credentials and user-bound caches on sign-out.
 * Keeps device prefs (theme, shell expanded, tour).
 */
export function clearUserBoundStorage(): void {
  clearStoredAuth();

  const removeExact = new Set([
    AUTH_STORAGE_KEY,
    'walkcroach.welcome.v1',
    'walkcroach.lastBuilderProjectId',
  ]);
  const removePrefixes = [
    'walkcroach.chat.session.v1.',
    'walkcroach.session.v1.',
  ];

  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (removeExact.has(key) || removePrefixes.some((p) => key.startsWith(p))) {
      doomed.push(key);
    }
  }
  for (const key of doomed) localStorage.removeItem(key);

  try {
    sessionStorage.removeItem('walkcroach.signup.pending.v1');
  } catch {
    /* ignore */
  }
}
