import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { getChromeApiBaseUrl } from '../../api/client';
import { loadStoredAuth } from '../../auth/storage';
import { useAuth } from '../../auth/useAuth';
import { AuthCard, AuthError, AuthLink } from '../../components/auth/AuthCard';

/**
 * Must stay in sync with the Chrome BFF oauth redirect allowlist
 * (`lambda-chrome/.../handlers/oauth.ts` CHROME_REDIRECT_PATTERN) and the
 * extension's `lib/auth.ts`.
 *
 * `chromiumapp.org` is the chrome.identity.launchWebAuthFlow target (preferred);
 * `chrome-extension://…/auth.html` is the legacy tab redirect kept as fallback.
 */
const REDIRECT_PATTERN =
  /^(?:chrome-extension:\/\/[a-p]{32}\/auth\.html|https:\/\/[a-p]{32}\.chromiumapp\.org\/auth)$/;

function chromeApiBase(): string {
  return getChromeApiBaseUrl();
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
  // PKCE: Web is a conduit only. It forwards the challenge and never sees
  // the verifier — that is the whole point of the mechanism.
  const codeChallenge = params.get('code_challenge')?.trim() ?? '';
  const codeChallengeMethod = params.get('code_challenge_method')?.trim() ?? '';

  const nextPath = useMemo(() => {
    const q = new URLSearchParams();
    if (state) q.set('state', state);
    if (redirectUri) q.set('redirect_uri', redirectUri);
    // Must survive the sign-in round trip, or the retry after authentication
    // arrives without a challenge and the BFF rejects it.
    if (codeChallenge) q.set('code_challenge', codeChallenge);
    if (codeChallengeMethod) q.set('code_challenge_method', codeChallengeMethod);
    return `/connect/chrome?${q.toString()}`;
  }, [state, redirectUri, codeChallenge, codeChallengeMethod]);

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
      // Fail closed. A client old enough not to send a challenge cannot be
      // silently downgraded to a non-PKCE exchange.
      if (!codeChallenge || codeChallengeMethod !== 'S256') {
        setError(
          'This extension build is out of date — it did not send a PKCE challenge. Update WalkCroach Chrome and sign in again.',
        );
        return;
      }

      const stored = loadStoredAuth();
      if (!stored?.token) {
        setError(
          'Sign in with your WalkCroach email and password, then retry from the extension.',
        );
        return;
      }
      if (stored.token.startsWith('dev:')) {
        setError('Dev sessions cannot connect Chrome. Use a real account.');
        return;
      }
      if (!stored.cognito?.accessToken?.trim()) {
        setError(
          'This session is missing a Cognito access token. Sign out and sign in again on WalkCroach Web, then retry.',
        );
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
            // Refresh optional. accessToken is required (distinct from id Bearer).
            ...(stored.cognito?.refreshToken
              ? { refreshToken: stored.cognito.refreshToken }
              : {}),
            idToken: stored.cognito?.idToken ?? stored.token,
            // Real Cognito access token for the extension SDK slot — never the
            // Web Bearer (id token). Required so Chrome does not mislabel id as access.
            accessToken: stored.cognito?.accessToken,
            expiresAt: stored.cognito?.expiresAt,
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
  }, [status, state, redirectUri, codeChallenge, codeChallengeMethod]);

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
