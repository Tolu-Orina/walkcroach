import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { isCognitoEnabled, allowDevAuth, refreshCognitoTokens } from './cognito';
import {
  cognitoConfirmForgotPassword,
  cognitoConfirmSignUp,
  cognitoForgotPassword,
  cognitoResendConfirmation,
  cognitoSignIn,
  cognitoSignUp,
} from './cognito-idp';
import { AuthContext } from './auth-context';
import { sessionFromCognitoTokens } from './session';
import {
  clearStoredAuth,
  loadStoredAuth,
  persistAuth,
  type StoredAuth,
} from './storage';
import type { AuthState, AuthUser } from './types';

function makeUserId(prefix: 'user' | 'anon'): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function devToken(ownerId: string): string {
  return `dev:${ownerId}`;
}

function authStatusFromUser(user: AuthUser): AuthState['status'] {
  return user.isAnonymous ? 'anonymous' : 'authenticated';
}

function applySession(
  setState: (value: AuthState) => void,
  stored: StoredAuth,
): void {
  persistAuth(stored);
  setState({
    user: stored.user,
    token: stored.token,
    status: authStatusFromUser(stored.user),
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const cognitoEnabled = isCognitoEnabled();
  const devAuthAllowed = allowDevAuth();

  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    status: 'loading',
  });

  const completeSession = useCallback((stored: StoredAuth) => {
    setState({
      user: stored.user,
      token: stored.token,
      status: authStatusFromUser(stored.user),
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = loadStoredAuth();
      if (!stored?.user || !stored.token) {
        if (!cancelled) setState({ user: null, token: null, status: 'anonymous' });
        return;
      }

      if (stored.cognito?.refreshToken) {
        const expiresSoon = stored.cognito.expiresAt < Date.now() + 60_000;
        if (expiresSoon) {
          try {
            const refreshed = await refreshCognitoTokens(stored.cognito.refreshToken);
            const next = sessionFromCognitoTokens(refreshed);
            persistAuth(next);
            if (!cancelled) {
              setState({
                user: next.user,
                token: next.token,
                status: authStatusFromUser(next.user),
              });
            }
            return;
          } catch {
            clearStoredAuth();
            if (!cancelled) setState({ user: null, token: null, status: 'anonymous' });
            return;
          }
        }
      }

      if (!cancelled) {
        setState({
          user: stored.user,
          token: stored.token,
          status: authStatusFromUser(stored.user),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    (displayName?: string) => {
      if (cognitoEnabled) return;
      const id = makeUserId('user');
      const user: AuthUser = {
        id,
        displayName: displayName?.trim() || 'Builder',
        isAnonymous: false,
      };
      applySession(setState, { user, token: devToken(id) });
    },
    [cognitoEnabled],
  );

  const loginWithPassword = useCallback(async (email: string, password: string) => {
    const tokens = await cognitoSignIn(email.trim(), password);
    applySession(setState, sessionFromCognitoTokens(tokens));
  }, []);

  const registerAccount = useCallback(
    async (input: { email: string; password: string; name?: string }) => {
      await cognitoSignUp({
        email: input.email.trim(),
        password: input.password,
        name: input.name,
      });
    },
    [],
  );

  const confirmEmail = useCallback(async (email: string, code: string) => {
    await cognitoConfirmSignUp(email.trim(), code);
  }, []);

  const resendConfirmation = useCallback(async (email: string) => {
    await cognitoResendConfirmation(email.trim());
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    await cognitoForgotPassword(email.trim());
  }, []);

  const confirmPasswordReset = useCallback(
    async (email: string, code: string, password: string) => {
      await cognitoConfirmForgotPassword(email.trim(), code, password);
    },
    [],
  );

  const signInAnonymous = useCallback(() => {
    if (!devAuthAllowed) return;
    const id = makeUserId('anon');
    const user: AuthUser = {
      id,
      displayName: 'Guest',
      isAnonymous: true,
    };
    applySession(setState, { user, token: devToken(id) });
  }, [devAuthAllowed]);

  const signOut = useCallback(() => {
    clearStoredAuth();
    setState({ user: null, token: null, status: 'anonymous' });
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      signIn,
      signInAnonymous,
      signOut,
      completeSession,
      loginWithPassword,
      registerAccount,
      confirmEmail,
      resendConfirmation,
      requestPasswordReset,
      confirmPasswordReset,
      cognitoEnabled,
      devAuthAllowed,
    }),
    [
      state,
      signIn,
      signInAnonymous,
      signOut,
      completeSession,
      loginWithPassword,
      registerAccount,
      confirmEmail,
      resendConfirmation,
      requestPasswordReset,
      confirmPasswordReset,
      cognitoEnabled,
      devAuthAllowed,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
