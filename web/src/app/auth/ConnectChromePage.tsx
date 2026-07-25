import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { loadStoredAuth } from '../../auth/storage';
import { useAuth } from '../../auth/useAuth';
import { AuthCard, AuthError, AuthLink } from '../../components/auth/AuthCard';

/** Must stay in sync with Chrome BFF oauth redirect allowlist. */
const REDIRECT_PATTERN = /^chrome-extension:\/\/[a-p]{32}\/auth\.html$/;

function chromeApiBase(): string {
  return String(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
}

/**
 * Same pattern as ConnectIdePage: reuse normal Web sign-in, then issue a
 * one-time authorization code (never put tokens in the extension redirect URL).
 */
export function ConnectChromePage() {
  const { status } = useAuth();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState(
    'Connecting to WalkCroach Chrome…',
  );

  const state = params.get('state')?.trim() ?? '';
  const redirectUri = params.get('redirect_uri')?.trim() ?? '';

  const nextPath = useMemo(() => {
    const q = new URLSearchParams();
    if (state) q.set('state', state);
    if (redirectUri) q.set('redirect_uri', redirectUri);
    return `/connect/chrome?${q.toString()}`;
  }, [state, redirectUri]);

  useEffect(() => {
    if (status !== 'authenticated') return;

    let cancelled = false;

    (async () => {
      if (!state) {
        setError(
          'Missing state from the extension. Close this tab and click Sign in again in WalkCroach Chrome.',
        );
        return;
      }
      if (!redirectUri || !REDIRECT_PATTERN.test(redirectUri)) {
        setError('Invalid redirect URI.');
        return;
      }

      const stored = loadStoredAuth();
      if (!stored?.token || !stored.cognito?.refreshToken) {
        setError(
          'Sign in with your WalkCroach email and password, then retry from the extension.',
        );
        return;
      }
      if (stored.token.startsWith('dev:')) {
        setError('Dev sessions cannot connect Chrome. Use a real account.');
        return;
      }

      const base = chromeApiBase();
      if (!base) {
        setError('API URL is not configured in this Web build.');
        return;
      }

      try {
        setStatusText('Issuing a one-time connect code…');
        const res = await fetch(`${base}/chrome/v1/oauth/session-code`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${stored.token}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            state,
            redirectUri,
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

        const target = new URL(redirectUri);
        target.searchParams.set('code', data.code);
        target.searchParams.set('state', state);
        setStatusText('Returning to WalkCroach Chrome…');
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
      title="Connect Chrome"
      subtitle="Using your existing WalkCroach account"
      footer={
        <p className="text-sm text-mist">
          <AuthLink to="/app/projects">Back to projects</AuthLink>
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
