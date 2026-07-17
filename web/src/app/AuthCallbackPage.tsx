import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  exchangeCodeForTokens,
  parseIdToken,
} from '../auth/cognito';
import type { AuthUser } from '../auth/types';

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

function persistAuth(stored: StoredAuth): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get('code');
    const err = params.get('error');
    if (err) {
      setError(params.get('error_description') ?? err);
      return;
    }
    if (!code) {
      setError('Missing authorization code');
      return;
    }

    void (async () => {
      try {
        const tokens = await exchangeCodeForTokens(code);
        const profile = parseIdToken(tokens.idToken);
        const user: AuthUser = {
          id: profile.sub,
          displayName: profile.name ?? profile.email ?? 'Builder',
          isAnonymous: false,
        };
        persistAuth({
          user,
          token: tokens.accessToken,
          cognito: {
            idToken: tokens.idToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
          },
        });
        navigate('/dashboard', { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [params, navigate]);

  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-ember">
        Sign-in failed: {error}
      </div>
    );
  }

  return (
    <div className="grid h-full place-items-center text-sm text-mist">
      Completing sign-in…
    </div>
  );
}
