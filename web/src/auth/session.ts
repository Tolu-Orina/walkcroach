import { parseIdToken, type CognitoTokens } from './cognito';
import type { StoredAuth } from './storage';

export function sessionFromCognitoTokens(tokens: CognitoTokens): StoredAuth {
  const profile = parseIdToken(tokens.idToken);
  return {
    user: {
      id: profile.sub,
      displayName: profile.name ?? profile.email ?? 'Builder',
      isAnonymous: false,
    },
    token: tokens.accessToken,
    cognito: {
      idToken: tokens.idToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    },
  };
}

export const WELCOME_STORAGE_KEY = 'walkcroach.welcome.v1';

export function hasCompletedWelcome(): boolean {
  return localStorage.getItem(WELCOME_STORAGE_KEY) === '1';
}

export function markWelcomeComplete(): void {
  localStorage.setItem(WELCOME_STORAGE_KEY, '1');
}
