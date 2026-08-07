import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { getSdkApiBaseUrl } from '../../api/client';
import { loadStoredAuth } from '../../auth/storage';
import { useAuth } from '../../auth/useAuth';
import { AuthCard, AuthError, AuthLink } from '../../components/auth/AuthCard';

/** Must stay in sync with IDE BFF oauth redirect allowlist. */
const REDIRECT_PATTERN =
  /^(vscode|cursor|vscode-insiders|vscodium|windsurf|code-oss):\/\/walkcroach\.walkcroach-ide\/auth$/;

const DEFAULT_REDIRECT = 'vscode://walkcroach.walkcroach-ide/auth';

function ideApiBase(): string {
  return getSdkApiBaseUrl();
}

/**
 * Industry-standard IDE connect: reuse normal Web sign-in, then issue a
 * one-time authorization code (never put tokens in the IDE deep-link URL).
 * redirect_uri is platform-aware (vscode:// vs cursor://).
 */
export function ConnectIdePage() {
  const { status } = useAuth();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('Connecting to WalkCroach IDE…');

  const state = params.get('state')?.trim() ?? '';
  const redirectUri = params.get('redirect_uri')?.trim() ?? DEFAULT_REDIRECT;
  // PKCE: Web is a conduit only. It forwards the challenge and never sees the
  // verifier — that is the whole point, since this page runs in a browser the
  // user could have any number of other things installed in.
  const codeChallenge = params.get('code_challenge')?.trim() ?? '';
  const codeChallengeMethod = params.get('code_challenge_method')?.trim() ?? '';

  const nextPath = useMemo(() => {
    const q = new URLSearchParams();
    if (state) q.set('state', state);
    q.set('redirect_uri', redirectUri);
    // Must survive the sign-in round trip, or the retry after authentication
    // arrives without a challenge and the BFF rejects it.
    if (codeChallenge) q.set('code_challenge', codeChallenge);
    if (codeChallengeMethod) q.set('code_challenge_method', codeChallengeMethod);
    return `/connect/ide?${q.toString()}`;
  }, [state, redirectUri, codeChallenge, codeChallengeMethod]);

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
      if (!REDIRECT_PATTERN.test(redirectUri)) {
        setError('Invalid redirect URI.');
        return;
      }
      // Fail closed. An IDE build old enough not to send a challenge cannot be
      // silently downgraded to a non-PKCE exchange — the BFF would reject it
      // anyway, and this produces the actionable message instead of a 400.
      if (!codeChallenge || codeChallengeMethod !== 'S256') {
        setError(
          'This IDE build is out of date — it did not send a PKCE challenge. Update the WalkCroach extension and sign in again.',
        );
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
            redirectUri,
            refreshToken: stored.cognito.refreshToken,
            idToken: stored.cognito.idToken,
            expiresAt: stored.cognito.expiresAt,
            codeChallenge,
            codeChallengeMethod,
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
  }, [status, state, redirectUri, codeChallenge, codeChallengeMethod]);

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
