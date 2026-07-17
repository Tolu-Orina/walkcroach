import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { createProject, getProject } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthCallbackPage } from './AuthCallbackPage';
import { AuthGithubCallbackPage } from './AuthGithubCallbackPage';
import { BuilderPage } from './BuilderPage';
import { DashboardPage } from './DashboardPage';
import { LandingPage } from './LandingPage';
import { ProtectedRoute } from './ProtectedRoute';

function ProjectRoute() {
  const { projectId } = useParams<{ projectId: string }>();
  const [name, setName] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const project = await getProject(projectId);
        if (!cancelled) {
          setName(project.name);
          setTemplateId(project.templateId);
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
  }, [projectId]);

  if (!projectId) return <Navigate to="/dashboard" replace />;
  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-ember">
        {error}
      </div>
    );
  }
  if (!name) {
    return (
      <div className="grid h-full place-items-center text-sm text-mist">
        Loading project…
      </div>
    );
  }

  return (
    <BuilderPage projectId={projectId} projectName={name} templateId={templateId} />
  );
}

function TryRoute() {
  const { status } = useAuth();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'anonymous') return;
    let cancelled = false;
    (async () => {
      try {
        const { id } = await createProject('Guest scratch', 'todo');
        if (!cancelled) setProjectId(id);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }

  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-ember">
        {error}
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="grid h-full place-items-center text-sm text-mist">
        Starting guest session…
      </div>
    );
  }

  return (
    <BuilderPage projectId={projectId} projectName="Guest scratch" templateId="todo" />
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute requireSignedIn>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/project/:projectId"
        element={
          <ProtectedRoute>
            <ProjectRoute />
          </ProtectedRoute>
        }
      />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/auth/github/callback" element={<AuthGithubCallbackPage />} />
      <Route
        path="/try"
        element={
          <ProtectedRoute>
            <TryRoute />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
