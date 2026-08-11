import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { createSession, listProjects } from '../api/client';
import type { ProjectSummary } from '../api/types';
import { useAuth } from '../auth/useAuth';
import { BrandLogo } from '../components/BrandLogo';
import { LoadingScreen } from '../components/LoadingScreen';
import { ProductErrorBanner } from '../components/product/ProductErrorBanner';
import {
  readLastKnowledgeProjectId,
  rememberKnowledgeProject,
} from '../lib/lastKnowledgeProject';
import {
  isResumeSkipped,
  markResumeChoiceMade,
} from '../lib/postAuthDestination';

/**
 * Post-login continuity gate: continue a knowledge project or start a new chat.
 * Skips to /app/chat when no projects, skip window active, or load fails soft.
 */
export function ResumePage() {
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'continue' | 'new' | null>(null);

  const firstName =
    user?.displayName?.trim().split(/\s+/)[0] ||
    user?.email?.split('@')[0] ||
    'there';

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await listProjects({ kind: 'knowledge' });
      setProjects(list);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load projects — starting chat instead.',
      );
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (status !== 'authenticated') {
    return <Navigate to="/signin" replace />;
  }

  if (isResumeSkipped()) {
    return <Navigate to="/app/chat" replace />;
  }

  if (projects === null) {
    return <LoadingScreen message="Loading your projects…" />;
  }

  if (projects.length === 0 && !error) {
    return <Navigate to="/app/chat" replace />;
  }

  const lastId = readLastKnowledgeProjectId();
  const preferred =
    (lastId && projects.find((p) => p.id === lastId)) ||
    [...projects].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];

  const continueProject = async () => {
    if (!preferred || busy) return;
    setBusy('continue');
    setError(null);
    try {
      rememberKnowledgeProject(preferred.id);
      markResumeChoiceMade();
      const session = await createSession(preferred.id, 'chat');
      navigate(`/app/projects/${preferred.id}/chat/${session.id}`, {
        replace: true,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not open project chat — try again.',
      );
      setBusy(null);
    }
  };

  const startNewChat = () => {
    if (busy) return;
    setBusy('new');
    markResumeChoiceMade();
    navigate('/app/chat', { replace: true, state: { newChat: true } });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-5 py-10 sm:px-8">
      <div className="mx-auto my-auto w-full max-w-lg">
        <div className="wc-enter flex flex-col items-center text-center">
          <BrandLogo to="/app/chat" showWordmark={false} className="mb-6" />
          <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">
            Hello, {firstName}
          </p>
          <h1 className="mt-3 font-display text-[1.85rem] font-extrabold tracking-tight text-paper sm:text-[2.1rem]">
            Continue with memory, or start fresh?
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-mist">
            Pick up shared project context, or open a clean personal chat.
          </p>
        </div>

        {error && (
          <div className="mt-6">
            <ProductErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}

        {preferred && (
          <div className="mt-8 space-y-3">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void continueProject()}
              className="btn-primary w-full justify-center py-3 text-sm"
            >
              {busy === 'continue'
                ? 'Opening…'
                : `Continue “${preferred.name}”`}
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={startNewChat}
              className="btn-secondary w-full justify-center py-3 text-sm"
            >
              {busy === 'new' ? 'Starting…' : 'Start a new chat'}
            </button>
            <p className="pt-1 text-center text-sm text-mist">
              <Link
                to="/app/projects"
                className="interactive font-medium text-signal hover:underline"
                onClick={() => markResumeChoiceMade()}
              >
                See all projects
              </Link>
            </p>
          </div>
        )}

        {!preferred && projects.length === 0 && error && (
          <div className="mt-8">
            <button
              type="button"
              onClick={startNewChat}
              className="btn-primary w-full justify-center py-3 text-sm"
            >
              Start a new chat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
