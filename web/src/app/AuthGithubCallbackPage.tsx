import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { completeGithubInstall } from '../api/client';

export function AuthGithubCallbackPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const installationId = search.get('installation_id');
      const state = search.get('state');
      if (!installationId || !state) {
        if (!cancelled) setError('Missing installation_id or state from GitHub');
        return;
      }

      try {
        const result = await completeGithubInstall(
          Number(installationId),
          state,
        );
        if (!cancelled) {
          navigate(`/project/${result.projectId}`, { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, search]);

  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-ember">
        GitHub connect failed: {error}
      </div>
    );
  }

  return (
    <div className="grid h-full place-items-center text-sm text-mist">
      Completing GitHub connection…
    </div>
  );
}
