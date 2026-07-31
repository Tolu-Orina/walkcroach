import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { completeConnectorOauth } from '../api/client';

/**
 * OAuth redirect landing — exchanges ?code&state via authenticated API,
 * then returns to Connections.
 */
export function ConnectionsCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get('code');
    const state = params.get('state');
    const oauthError = params.get('error');
    if (oauthError) {
      setError(oauthError);
      return;
    }
    if (!code || !state) {
      setError('Missing OAuth code or state');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await completeConnectorOauth({ code, state });
        if (cancelled) return;
        navigate(
          `/app/settings/connections?connected=${encodeURIComponent(res.provider)}`,
          { replace: true },
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, navigate]);

  return (
    <div className="mx-auto max-w-md px-5 py-16 text-center">
      <p className="eyebrow">Connections</p>
      <h1 className="mt-3 font-display text-2xl font-bold text-paper">
        {error ? 'Connection failed' : 'Finishing connection…'}
      </h1>
      {error && <p className="mt-3 text-sm text-ember">{error}</p>}
    </div>
  );
}
