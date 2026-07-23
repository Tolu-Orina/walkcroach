import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { createProject, getProject } from '../api/client';
import { hasCompletedWelcome } from '../auth/session';
import { useAuth } from '../auth/useAuth';
import { AppShell } from '../components/AppShell';
import { ProjectPageSkeleton } from '../components/Skeleton';
import { peekPendingPrompt, projectNameFromPrompt } from '../lib/pending-prompt';
import { ConnectIdePage } from './auth/ConnectIdePage';
import { ForgotPasswordPage } from './auth/ForgotPasswordPage';
import { ResetPasswordPage } from './auth/ResetPasswordPage';
import { SignInPage } from './auth/SignInPage';
import { SignUpPage } from './auth/SignUpPage';
import { VerifyEmailPage } from './auth/VerifyEmailPage';
import { AuthGithubCallbackPage } from './AuthGithubCallbackPage';
import { BuilderPage } from './BuilderPage';
import { DashboardPage } from './DashboardPage';
import { LandingPage } from './LandingPage';
import { ProtectedRoute } from './ProtectedRoute';
import { WelcomePage } from './WelcomePage';

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
      <AppShell>
        <ProjectPageSkeleton />
      </AppShell>
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
        const pending = peekPendingPrompt();
        const templateId = pending?.templateId ?? 'blank';
        const name = pending ? projectNameFromPrompt(pending.prompt) : 'Guest scratch';
        const { id } = await createProject(name, templateId);
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
      <AppShell>
        <ProjectPageSkeleton />
      </AppShell>
    );
  }

  const pending = peekPendingPrompt();
  const displayName = pending ? projectNameFromPrompt(pending.prompt) : 'Guest scratch';
  const templateId = pending?.templateId ?? 'blank';

  return (
    <BuilderPage projectId={projectId} projectName={displayName} templateId={templateId} />
  );
}

function DashboardGate() {
  if (!hasCompletedWelcome()) {
    return <Navigate to="/welcome" replace />;
  }
  return <DashboardPage />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/connect/ide" element={<ConnectIdePage />} />
      <Route path="/verify" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/welcome"
        element={
          <ProtectedRoute requireSignedIn>
            <WelcomePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute requireSignedIn>
            <DashboardGate />
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
