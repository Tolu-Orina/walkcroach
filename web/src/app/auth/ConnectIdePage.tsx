import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { loadStoredAuth } from '../../auth/storage';
import { useAuth } from '../../auth/useAuth';
import { AuthCard, AuthError, AuthLink } from '../../components/auth/AuthCard';

const ALLOWED_REDIRECT = 'vscode://walkcroach.walkcroach-ide/auth';

function ideApiBase(): string {
  return String(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
}

/**
 * Industry-standard IDE connect: reuse normal Web sign-in, then issue a
 * one-time authorization code (never put tokens in the vscode:// URL).
 */
export function ConnectIdePage() {
  const { status } = useAuth();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('Connecting to WalkCroach IDE…');

  const state = params.get('state')?.trim() ?? '';
  const redirectUri = params.get('redirect_uri')?.trim() ?? ALLOWED_REDIRECT;

  const nextPath = useMemo(() => {
    const q = new URLSearchParams();
    if (state) q.set('state', state);
    q.set('redirect_uri', redirectUri);
    return `/connect/ide?${q.toString()}`;
  }, [state, redirectUri]);

  useEffect(() => {
    if (status !== 'authenticated') return;

    let cancelled = false;

    (async () => {
      if (!state) {
        setError(
          'Missing state from the IDE. Close this tab and run WalkCroach: Sign In again.',
        );
        return;
      }
      if (redirectUri !== ALLOWED_REDIRECT) {
        setError('Invalid redirect URI.');
        return;
      }

      const stored = loadStoredAuth();
      if (!stored?.token || !stored.cognito?.refreshToken) {
        setError(
          'Sign in with your WalkCroach email and password, then retry from the IDE.',
        );
        return;
      }
      if (stored.token.startsWith('dev:')) {
        setError('Dev sessions cannot connect the IDE. Use a real account.');
        return;
      }

      const base = ideApiBase();
      if (!base) {
        setError('API URL is not configured in this Web build.');
        return;
      }

      try {
        setStatusText('Issuing a one-time connect code…');
        const res = await fetch(`${base}/ide/v1/oauth/session-code`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${stored.token}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            state,
            redirectUri: ALLOWED_REDIRECT,
            refreshToken: stored.cognito.refreshToken,
            idToken: stored.cognito.idToken,
            expiresAt: stored.cognito.expiresAt,
          }),
        });
        const data = (await res.json()) as {
          code?: string;
          error?: string;
        };
        if (!res.ok || !data.code) {
          throw new Error(data.error || `Connect failed (${res.status})`);
        }
        if (cancelled) return;

        const target = new URL(ALLOWED_REDIRECT);
        target.searchParams.set('code', data.code);
        target.searchParams.set('state', state);
        setStatusText('Returning to your IDE…');
        window.location.assign(target.toString());
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, state, redirectUri]);

  if (status !== 'authenticated') {
    return (
      <Navigate to={`/signin?next=${encodeURIComponent(nextPath)}`} replace />
    );
  }

  return (
    <AuthCard
      title="Connect IDE"
      subtitle="Using your existing WalkCroach account"
      footer={
        <p className="text-sm text-mist">
          <AuthLink to="/dashboard">Back to dashboard</AuthLink>
          {' · '}
          <Link className="underline" to="/signin">
            Switch account
          </Link>
        </p>
      }
    >
      <AuthError message={error} />
      {!error && <p className="text-sm text-mist">{statusText}</p>}
    </AuthCard>
  );
}
