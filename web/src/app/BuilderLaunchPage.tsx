import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { createProject, listProjects } from '../api/client';
import { LoadingScreen } from '../components/LoadingScreen';
import {
  readLastBuilderProjectId,
  rememberBuilderProject,
} from '../lib/lastBuilderProject';

/**
 * Rail entry for Builder — resolves to the last Builder project,
 * else the most recently updated project, else creates a blank one.
 */
export function BuilderLaunchPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const last = readLastBuilderProjectId();
        const projects = await listProjects();
        if (cancelled) return;

        if (last && projects.some((p) => p.id === last)) {
          setTarget(last);
          return;
        }
        if (projects[0]) {
          rememberBuilderProject(projects[0].id);
          setTarget(projects[0].id);
          return;
        }

        const { id } = await createProject('Untitled project');
        if (cancelled) return;
        rememberBuilderProject(id);
        setTarget(id);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-sm text-ember">
        <div>
          <p>{error}</p>
          <button
            type="button"
            className="btn-ghost mt-4 text-sm"
            onClick={() => navigate('/app/projects')}
          >
            Go to Projects
          </button>
        </div>
      </div>
    );
  }

  if (!target) {
    return <LoadingScreen message="Opening Builder…" />;
  }

  return <Navigate to={`/app/projects/${target}/builder`} replace />;
}
