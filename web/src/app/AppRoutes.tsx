import { useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useParams, Link } from 'react-router-dom';
import { createProject, getProject } from '../api/client';
import { hasCompletedWelcome } from '../auth/session';
import { useAuth } from '../auth/useAuth';
import { AppShell } from '../components/AppShell';
import { EcosystemShell } from '../components/EcosystemShell';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ProjectPageSkeleton } from '../components/Skeleton';
import { peekPendingPrompt, projectNameFromPrompt } from '../lib/pending-prompt';
import { AppsHubPage } from './AppsHubPage';
import { AuthGithubCallbackPage } from './AuthGithubCallbackPage';
import { ConnectChromePage } from './auth/ConnectChromePage';
import { ConnectIdePage } from './auth/ConnectIdePage';
import { ConnectCliPage } from './auth/ConnectCliPage';
import { ForgotPasswordPage } from './auth/ForgotPasswordPage';
import { ResetPasswordPage } from './auth/ResetPasswordPage';
import { SignInPage } from './auth/SignInPage';
import { SignUpPage } from './auth/SignUpPage';
import { VerifyEmailPage } from './auth/VerifyEmailPage';
import { BuilderLaunchPage } from './BuilderLaunchPage';
import { BuilderPage } from './BuilderPage';
import { ChatHomePage } from './ChatHomePage';
import { CodeArtefactPage } from './CodeArtefactPage';
import { CodeLibraryPage } from './CodeLibraryPage';
import { DashboardPage } from './DashboardPage';
import { DebugScreensPage } from './DebugScreensPage';
import { LandingPage } from './LandingPage';
import { ProjectChatPage } from './ProjectChatPage';
import { ProjectHomePage } from './ProjectHomePage';
import { ProtectedRoute } from './ProtectedRoute';
import { SettingsPage } from './SettingsPage';
import { ConnectionsPage } from './ConnectionsPage';
import { ConnectionsCallbackPage } from './ConnectionsCallbackPage';
import { DeveloperLayout } from './developer/DeveloperLayout';
import { DeveloperOverviewPage } from './developer/DeveloperOverviewPage';
import { DeveloperKeysPage } from './developer/DeveloperKeysPage';
import { DeveloperOpsPage } from './developer/DeveloperOpsPage';
import { DeveloperDocsPage } from './developer/DeveloperDocsPage';
import { DeveloperGovernancePage } from './developer/DeveloperGovernancePage';
import { WelcomePage } from './WelcomePage';
import { ResumePage } from './ResumePage';

function LegacyProjectRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return <Navigate to="/app/projects" replace />;
  return <Navigate to={`/app/projects/${projectId}`} replace />;
}

/** Phase 6: old `/app/projects/:id/builder` → `/app/builder/:id`. */
function LegacyBuilderWorkspaceRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return <Navigate to="/app/builder" replace />;
  return <Navigate to={`/app/builder/${projectId}`} replace />;
}

function ProjectRoute() {
  const { projectId } = useParams<{ projectId: string }>();
  const [name, setName] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
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
          setKind(project.kind ?? 'app');
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

  if (!projectId) return <Navigate to="/app/projects" replace />;
  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-ember">
        {error}
      </div>
    );
  }
  if (!name || !kind) {
    return (
      <AppShell wide>
        <ProjectPageSkeleton />
      </AppShell>
    );
  }

  // App Builder only opens kind=app workspaces (ADR-0004 Phase 2).
  if (kind !== 'app') {
    return <Navigate to={`/app/projects/${projectId}`} replace />;
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
        const { id } = await createProject(name, templateId, { kind: 'app' });
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
    return <Navigate to="/app/builder" replace />;
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
      <AppShell wide>
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

function AppLayout() {
  return (
    <EcosystemShell>
      <ErrorBoundary label="app">
        <Outlet />
      </ErrorBoundary>
    </EcosystemShell>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/debug/screens" element={<DebugScreensPage />} />
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/connect/ide" element={<ConnectIdePage />} />
      <Route path="/connect/cli" element={<ConnectCliPage />} />
      <Route path="/connect/chrome" element={<ConnectChromePage />} />
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

      {/* Revamp shell — authenticated home */}
      <Route
        path="/app"
        element={
          <ProtectedRoute requireSignedIn>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="resume" replace />} />
        <Route path="resume" element={<ResumePage />} />
        <Route path="chat/:chatId?" element={<ChatHomePage />} />
        <Route path="projects" element={<DashboardGate />} />
        <Route path="projects/:projectId" element={<ProjectHomePage />} />
        <Route
          path="projects/:projectId/chat/:chatId"
          element={<ProjectChatPage />}
        />
        <Route path="code" element={<CodeLibraryPage />} />
        <Route path="code/:artefactId" element={<CodeArtefactPage />} />
        <Route path="apps" element={<AppsHubPage />} />
        <Route path="builder" element={<BuilderLaunchPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/connections" element={<ConnectionsPage />} />
        <Route
          path="settings/connections/callback"
          element={<ConnectionsCallbackPage />}
        />
        <Route path="developer" element={<DeveloperLayout />}>
          <Route index element={<DeveloperOverviewPage />} />
          <Route path="keys" element={<DeveloperKeysPage />} />
          <Route path="ops" element={<DeveloperOpsPage />} />
          <Route path="governance" element={<DeveloperGovernancePage />} />
          <Route path="docs" element={<DeveloperDocsPage />} />
        </Route>
      </Route>

      {/* Legacy redirects */}
      <Route
        path="/dashboard"
        element={<Navigate to="/app/projects" replace />}
      />

      <Route
        path="/project/:projectId"
        element={<LegacyProjectRedirect />}
      />
      <Route
        path="/app/builder/:projectId"
        element={
          <ProtectedRoute requireSignedIn>
            <ErrorBoundary label="builder">
              <ProjectRoute />
            </ErrorBoundary>
          </ProtectedRoute>
        }
      />
      <Route
        path="/app/projects/:projectId/builder"
        element={
          <ProtectedRoute requireSignedIn>
            <LegacyBuilderWorkspaceRedirect />
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
      <Route
        path="/app/*"
        element={
          <ProtectedRoute requireSignedIn>
            <div className="grid min-h-[50vh] place-items-center px-6 text-center">
              <div className="space-y-2">
                <p className="font-display text-lg font-bold text-paper">
                  Page not found
                </p>
                <p className="text-sm text-mist">
                  That /app path does not exist.
                </p>
                <Link to="/app/chat" className="btn-ghost text-xs">
                  Back to Chat
                </Link>
              </div>
            </div>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
