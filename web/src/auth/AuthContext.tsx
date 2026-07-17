import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  allowDevAuth,
  cognitoLogoutUrl,
  isCognitoEnabled,
  refreshCognitoTokens,
  startCognitoSignIn,
} from './cognito';
import type { AuthState, AuthUser } from './types';

const STORAGE_KEY = 'walkcroach.auth.v1';

type StoredAuth = {
  user: AuthUser;
  token: string;
  cognito?: {
    idToken: string;
    refreshToken: string;
    expiresAt: number;
  };
};

function loadStored(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

function persist(user: AuthUser, token: string, cognito?: StoredAuth['cognito']): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, token, cognito }));
}

function makeUserId(prefix: 'user' | 'anon'): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function devToken(ownerId: string): string {
  return `dev:${ownerId}`;
}

type AuthContextValue = AuthState & {
  signIn: (displayName?: string) => void;
  signInAnonymous: () => void;
  signOut: () => void;
  cognitoEnabled: boolean;
  devAuthAllowed: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const cognitoEnabled = isCognitoEnabled();
  const devAuthAllowed = allowDevAuth();

  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    status: 'loading',
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = loadStored();
      if (!stored?.user || !stored.token) {
        if (!cancelled) setState({ user: null, token: null, status: 'anonymous' });
        return;
      }

      if (stored.cognito?.refreshToken) {
        const expiresSoon = stored.cognito.expiresAt < Date.now() + 60_000;
        if (expiresSoon) {
          try {
            const refreshed = await refreshCognitoTokens(stored.cognito.refreshToken);
            persist(stored.user, refreshed.accessToken, {
              idToken: refreshed.idToken,
              refreshToken: refreshed.refreshToken,
              expiresAt: refreshed.expiresAt,
            });
            if (!cancelled) {
              setState({
                user: stored.user,
                token: refreshed.accessToken,
                status: 'authenticated',
              });
            }
            return;
          } catch {
            localStorage.removeItem(STORAGE_KEY);
            if (!cancelled) setState({ user: null, token: null, status: 'anonymous' });
            return;
          }
        }
      }

      if (!cancelled) {
        setState({
          user: stored.user,
          token: stored.token,
          status: stored.user.isAnonymous ? 'anonymous' : 'authenticated',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    (_displayName?: string) => {
      if (cognitoEnabled) {
        void startCognitoSignIn();
        return;
      }
      const id = makeUserId('user');
      const user: AuthUser = {
        id,
        displayName: _displayName?.trim() || 'Builder',
        isAnonymous: false,
      };
      const token = devToken(id);
      persist(user, token);
      setState({ user, token, status: 'authenticated' });
    },
    [cognitoEnabled],
  );

  const signInAnonymous = useCallback(() => {
    if (!devAuthAllowed) return;
    const id = makeUserId('anon');
    const user: AuthUser = {
      id,
      displayName: 'Guest',
      isAnonymous: true,
    };
    const token = devToken(id);
    persist(user, token);
    setState({ user, token, status: 'anonymous' });
  }, [devAuthAllowed]);

  const signOut = useCallback(() => {
    const hadCognito = Boolean(loadStored()?.cognito);
    localStorage.removeItem(STORAGE_KEY);
    setState({ user: null, token: null, status: 'anonymous' });
    if (hadCognito && cognitoEnabled) {
      window.location.assign(cognitoLogoutUrl());
    }
  }, [cognitoEnabled]);

  const value = useMemo(
    () => ({
      ...state,
      signIn,
      signInAnonymous,
      signOut,
      cognitoEnabled,
      devAuthAllowed,
    }),
    [state, signIn, signInAnonymous, signOut, cognitoEnabled, devAuthAllowed],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
