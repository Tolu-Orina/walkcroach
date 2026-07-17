import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createCheckpoint, getApiUrl } from '../api/client';
import type { AgentMode } from '../api/types';
import { ActivityPanel } from '../features/activity/ActivityPanel';
import { SignInPanel } from '../features/backend/SignInPanel';
import { DatabasePanel } from '../features/backend/DatabasePanel';
import { SecretsPanel } from '../features/backend/SecretsPanel';
import { UsageMeter } from '../features/billing/UsageMeter';
import { CheckpointPanel } from '../features/checkpoints/CheckpointPanel';
import { MessageRow } from '../features/chat/MessageRow';
import { DeployPanel } from '../features/deploy/DeployPanel';
import { GithubPanel } from '../features/github/GithubPanel';
import { OnboardingTour } from '../features/onboarding/OnboardingTour';
import { PlanReviewCard } from '../features/plan/PlanReviewCard';
import { PreviewBridge } from '../features/visual/PreviewBridge';
import { useAgentSession } from '../hooks/useAgentSession';
import { useFileSync } from '../hooks/useFileSync';
import { useWebContainer } from '../hooks/useWebContainer';
import { getTemplate } from '../templates';

type BuilderPageProps = {
  projectId: string;
  projectName: string;
  templateId: string | null;
};

export function BuilderPage({ projectId, projectName, templateId }: BuilderPageProps) {
  const [mode, setMode] = useState<AgentMode>('build');
  const [draft, setDraft] = useState('');
  const template = getTemplate(templateId);
  const scheduleSyncRef = useRef<() => void>(() => {});
  const wc = useWebContainer(
    projectId,
    projectName,
    templateId,
    () => scheduleSyncRef.current(),
  );
  const { scheduleSync, syncNow } = useFileSync(
    projectId,
    wc.listFiles,
    wc.status === 'ready',
  );
  scheduleSyncRef.current = scheduleSync;

  const handleAfterFileTurn = useCallback(
    async (sessionId: string) => {
      const files = await syncNow();
      if (files.length === 0) return;
      await createCheckpoint(projectId, {
        auto: true,
        sessionId,
        files,
        summary: 'Auto checkpoint after build turn',
      });
    },
    [projectId, syncNow],
  );

  const actions = useMemo(
    () => ({
      applyWriteFile: wc.applyWriteFile,
      applyEditFile: wc.applyEditFile,
      applyTerminal: wc.applyTerminal,
    }),
    [wc.applyWriteFile, wc.applyEditFile, wc.applyTerminal],
  );
  const session = useAgentSession(
    projectId,
    projectName,
    mode,
    actions,
    wc.status === 'ready',
    handleAfterFileTurn,
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || session.streaming) return;
    setDraft('');
    void session.sendPrompt(text);
  };

  const applyChip = (text: string) => {
    if (session.streaming || session.status !== 'ready') return;
    setDraft(text);
  };

  const applyScopedPrompt = (text: string) => {
    if (session.streaming || session.status !== 'ready') return;
    setDraft(text);
  };

  const scaffoldFiles = useCallback(
    (files: Record<string, string>) => {
      for (const [path, content] of Object.entries(files)) {
        void wc.applyWriteFile(path, content);
      }
    },
    [wc.applyWriteFile],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <OnboardingTour />
      <header className="flex items-end justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <p className="font-display text-3xl font-extrabold tracking-tight text-paper md:text-4xl">
            {projectName}
          </p>
          <p className="mt-1 max-w-xl text-sm text-mist">
            {template.name} · memory-first builder
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <UsageMeter />
          <Link
            to="/dashboard"
            className="text-[11px] text-mist underline-offset-2 hover:text-paper hover:underline"
          >
            ← Dashboard
          </Link>
          <div className="flex overflow-hidden rounded-sm border border-line text-xs uppercase tracking-wider">
            <button
              type="button"
              className={`px-3 py-1.5 ${mode === 'plan' ? 'bg-signal text-ink' : 'text-mist hover:text-paper'}`}
              onClick={() => setMode('plan')}
            >
              Plan
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 ${mode === 'build' ? 'bg-signal text-ink' : 'text-mist hover:text-paper'}`}
              onClick={() => setMode('build')}
            >
              Build
            </button>
          </div>
          <button
            type="button"
            onClick={() => void session.newSession()}
            className="text-[11px] text-mist underline-offset-2 hover:text-paper hover:underline"
          >
            New session
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col border-b border-line lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[11px] uppercase tracking-wider text-mist">
            <span>Agent</span>
            <span className="normal-case tracking-normal">
              {session.status === 'ready'
                ? `session ${session.sessionId?.slice(0, 8)}…`
                : session.status}
              {' · '}
              api {getApiUrl().replace(/^https?:\/\//, '')}
            </span>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {session.bootError && (
              <p className="text-sm text-ember">
                API bootstrap failed: {session.bootError}. Start the local backend
                (`cd infra-backend && npm run dev`) or set <code>VITE_API_URL</code>.
              </p>
            )}
            {session.messages.map((m) => (
              <MessageRow key={m.id} msg={m} />
            ))}
            {session.pendingPlan && (
              <PlanReviewCard
                plan={session.pendingPlan}
                disabled={session.streaming}
                onApprove={() => void session.submitPlanDecision('approve')}
                onAdjust={(feedback) =>
                  void session.submitPlanDecision('adjust', feedback)
                }
                onCancel={() => void session.submitPlanDecision('cancel')}
              />
            )}
            {session.streaming && (
              <p className="animate-pulse text-[11px] text-signal">streaming…</p>
            )}
          </div>

          <form onSubmit={onSubmit} className="border-t border-line p-3">
            {template.examplePrompts.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {template.examplePrompts.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => applyChip(chip)}
                    disabled={session.status !== 'ready' || session.streaming}
                    className="rounded-sm border border-line px-2 py-0.5 text-[10px] text-mist hover:border-signal/40 hover:text-paper disabled:opacity-40"
                  >
                    {chip.length > 48 ? `${chip.slice(0, 45)}…` : chip}
                  </button>
                ))}
              </div>
            )}
            <label className="sr-only" htmlFor="prompt">
              Prompt
            </label>
            <textarea
              id="prompt"
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                mode === 'plan'
                  ? 'Plan the app — no file writes yet…'
                  : 'Build a muted landing page with a contact CTA…'
              }
              className="w-full resize-none rounded-sm border border-line bg-ink/60 px-3 py-2 text-sm text-paper outline-none placeholder:text-mist/60 focus:border-signal/50"
              disabled={session.status !== 'ready' || session.streaming}
            />
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[11px] text-mist">
                {mode === 'build'
                  ? 'Build mode: write_file / edit_file / terminal'
                  : 'Plan mode: memory tools only'}
              </p>
              <button
                type="submit"
              disabled={
                session.status !== 'ready' ||
                session.streaming ||
                !!session.pendingPlan ||
                !draft.trim()
              }
                className="rounded-sm bg-signal px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </form>
          <ActivityPanel
            sessionId={session.sessionId}
            refreshKey={session.activityRefresh}
          />
        </section>

        <section className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[11px] uppercase tracking-wider text-mist">
            <span>Preview</span>
            <span className="normal-case tracking-normal">
              WebContainer · {wc.status}
              {wc.previewUrl ? ` · ${wc.previewUrl}` : ''}
            </span>
          </div>

          <div className="relative min-h-0 flex-1 bg-black/40">
            {wc.error && (
              <div className="absolute inset-0 z-10 grid place-items-center p-6 text-center text-sm text-ember">
                {wc.error}
              </div>
            )}
            {!wc.previewUrl && !wc.error && (
              <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-mist">
                Booting in-browser Node… first install can take a minute.
              </div>
            )}
            {wc.previewUrl && (
              <PreviewBridge
                projectId={projectId}
                previewUrl={wc.previewUrl}
                wcRef={wc.wcRef}
                onScopedPrompt={applyScopedPrompt}
                onFilesMutated={scheduleSync}
              />
            )}
          </div>

          <div className="max-h-36 overflow-y-auto border-t border-line bg-ink/80 px-3 py-2 font-mono text-[10px] leading-relaxed text-mist">
            {wc.logs.length === 0 ? (
              <span>terminal idle</span>
            ) : (
              wc.logs.slice(-40).map((line, i) => (
                <div key={`${i}-${line.slice(0, 12)}`} className="whitespace-pre-wrap">
                  {line}
                </div>
              ))
            )}
          </div>
          <CheckpointPanel
            projectId={projectId}
            sessionId={session.sessionId}
            listFiles={wc.listFiles}
            applySnapshot={(files) => wc.applySnapshot(files)}
            refreshKey={session.checkpointRefresh}
          />
          <DatabasePanel projectId={projectId} onScaffoldFiles={scaffoldFiles} />
          <SignInPanel onScaffold={scaffoldFiles} />
          <SecretsPanel projectId={projectId} />
          <DeployPanel
            projectId={projectId}
            projectName={projectName}
            listFiles={wc.listFiles}
            syncNow={syncNow}
            disabled={wc.status !== 'ready' || session.streaming}
          />
          <GithubPanel
            projectId={projectId}
            listFiles={wc.listFiles}
            syncNow={syncNow}
          />
        </section>
      </div>
    </div>
  );
}
