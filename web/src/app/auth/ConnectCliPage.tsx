import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { loadStoredAuth } from '../../auth/storage';
import { useAuth } from '../../auth/useAuth';
import { AuthCard, AuthError, AuthLink } from '../../components/auth/AuthCard';
import { isCliRedirectUri } from './cliRedirectUri';

function ideApiBase(): string {
  return String(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
}

/**
 * Sign-in handoff for the CLI (Phase C1.1).
 *
 * Same shape as Connect IDE — reuse the ordinary Web session, mint a one-time
 * code, and hand back only `code` + `state`, never a token — but the CLI
 * receives it on a loopback listener rather than an editor deep link
 * (RFC 8252 §7.3).
 */
export function ConnectCliPage() {
  const { status } = useAuth();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('Connecting to the WalkCroach CLI…');

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
    return `/connect/cli?${q.toString()}`;
  }, [state, redirectUri, codeChallenge, codeChallengeMethod]);

  useEffect(() => {
    if (status !== 'authenticated') return;

    let cancelled = false;

    (async () => {
      if (!state) {
        setError(
          'Missing state from the CLI. Close this tab and run `walkcroach auth login` again.',
        );
        return;
      }
      // No default redirect here, unlike the IDE page: there is no single
      // correct CLI port to fall back to, and guessing one would send a code
      // to a listener that never asked for it.
      if (!isCliRedirectUri(redirectUri)) {
        setError('Invalid redirect URI.');
        return;
      }
      // Fail closed. A client old enough not to send a challenge cannot be
      // silently downgraded to a non-PKCE exchange.
      if (!codeChallenge || codeChallengeMethod !== 'S256') {
        setError(
          'This CLI build is out of date — it did not send a PKCE challenge. Upgrade with `npm i -g @walkcroach/cli` and run `walkcroach auth login` again.',
        );
        return;
      }

      const stored = loadStoredAuth();
      if (!stored?.token || !stored.cognito?.refreshToken) {
        setError(
          'Sign in with your WalkCroach email and password, then retry from the CLI.',
        );
        return;
      }
      if (stored.token.startsWith('dev:')) {
        setError('Dev sessions cannot connect the CLI. Use a real account.');
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
        const data = (await res.json()) as { code?: string; error?: string };
        if (!res.ok || !data.code) {
          throw new Error(data.error || `Connect failed (${res.status})`);
        }
        if (cancelled) return;

        const target = new URL(redirectUri);
        target.searchParams.set('code', data.code);
        target.searchParams.set('state', state);
        setStatusText('Returning to your terminal…');
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
      title="Connect CLI"
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
