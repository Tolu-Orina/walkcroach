import type { AuthUser } from './types';

export const AUTH_STORAGE_KEY = 'walkcroach.auth.v1';

export type StoredAuth = {
  user: AuthUser;
  token: string;
  cognito?: {
    idToken: string;
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
