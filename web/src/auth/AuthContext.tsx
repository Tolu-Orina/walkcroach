import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { isCognitoEnabled, allowDevAuth, refreshCognitoTokens } from './cognito';
import {
  cognitoConfirmForgotPassword,
  cognitoConfirmSignUp,
  cognitoForgotPassword,
  cognitoGlobalSignOut,
  cognitoResendConfirmation,
  cognitoSignIn,
  cognitoSignUp,
} from './cognito-idp';
import { AuthContext } from './auth-context';
import { sessionFromCognitoTokens } from './session';
import { clearPendingSignup } from './signup-pending';
import {
  clearUserBoundStorage,
  loadStoredAuth,
  persistAuth,
  type StoredAuth,
} from './storage';
import type { AuthState, AuthUser } from './types';

function makeUserId(prefix: 'user' | 'anon'): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

/** Stable owner for “Continue locally (dev)” so local data survives re-sign-in. */
const LOCAL_DEBUGGER_ID = 'user:local-debugger';

function resolveDevUserId(displayName: string): string {
  return displayName === 'Local Debugger'
    ? LOCAL_DEBUGGER_ID
    : makeUserId('user');
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
  const navigate = useNavigate();
  const cognitoEnabled = isCognitoEnabled();
  const devAuthAllowed = allowDevAuth();

  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    status: 'loading',
  });

  const completeSession = useCallback((stored: StoredAuth) => {
    applySession(setState, stored);
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
            clearUserBoundStorage();
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
      // Local debug: allow forged Bearer tokens when VITE_ALLOW_DEV_AUTH=true,
      // even if Cognito client env is also present.
      if (cognitoEnabled && !devAuthAllowed) return;
      const display = displayName?.trim() || 'Builder';
      const id = resolveDevUserId(display);
      const user: AuthUser = {
        id,
        displayName: display,
        isAnonymous: false,
      };
      applySession(setState, { user, token: devToken(id) });
    },
    [cognitoEnabled, devAuthAllowed],
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

  const signOut = useCallback(async () => {
    const stored = loadStoredAuth();
    const accessToken = stored?.cognito?.accessToken;
    if (accessToken) {
      try {
        await cognitoGlobalSignOut(accessToken);
      } catch {
        // Still clear local credentials even if Cognito revoke fails (offline, expired).
      }
    }
    clearPendingSignup();
    clearUserBoundStorage();
    setState({ user: null, token: null, status: 'anonymous' });
    navigate('/signin', { replace: true });
  }, [navigate]);

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
