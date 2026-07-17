import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createCheckpoint } from '../api/client';
import type { AgentMode } from '../api/types';
import { AppShell } from '../components/AppShell';
import { ActivityPanel } from '../features/activity/ActivityPanel';
import { SignInPanel } from '../features/backend/SignInPanel';
import { DatabasePanel } from '../features/backend/DatabasePanel';
import { SecretsPanel } from '../features/backend/SecretsPanel';
import { BuilderHeader } from '../features/builder/BuilderHeader';
import { BuilderWorkspaceTabs } from '../features/builder/BuilderWorkspaceTabs';
import { PreviewBootOverlay } from '../features/builder/PreviewBootOverlay';
import { ResizableSplitPane } from '../features/builder/ResizableSplitPane';
import { CheckpointPanel } from '../features/checkpoints/CheckpointPanel';
import { MessageRow, StreamingSkeleton } from '../features/chat/MessageRow';
import { DeployPanel } from '../features/deploy/DeployPanel';
import { useDeploy } from '../features/deploy/useDeploy';
import { GithubPanel } from '../features/github/GithubPanel';
import { CoachMarkTour } from '../features/onboarding/CoachMarkTour';
import { PlanReviewCard } from '../features/plan/PlanReviewCard';
import { PreviewBridge } from '../features/visual/PreviewBridge';
import { useAgentSession } from '../hooks/useAgentSession';
import { useFileSync } from '../hooks/useFileSync';
import { useWebContainer } from '../hooks/useWebContainer';
import { consumePendingPrompt } from '../lib/pending-prompt';
import { getTemplate } from '../templates';

type BuilderPageProps = {
  projectId: string;
  projectName: string;
  templateId: string | null;
};

export function BuilderPage({ projectId, projectName, templateId }: BuilderPageProps) {
  const [mode, setMode] = useState<AgentMode>('build');
  const [draft, setDraft] = useState('');
  const initialPromptRef = useRef(consumePendingPrompt());
  const sentInitialRef = useRef(false);
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

  const deployState = useDeploy(projectId, projectName, wc.listFiles, syncNow);
  const deployDisabled = wc.status !== 'ready';

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
  const { status: sessionStatus, streaming, sendPrompt } = session;

  useEffect(() => {
    const initialPrompt = initialPromptRef.current?.prompt;
    if (!initialPrompt || sentInitialRef.current) return;
    if (sessionStatus !== 'ready' || wc.status !== 'ready' || streaming) return;
    sentInitialRef.current = true;
    void sendPrompt(initialPrompt);
  }, [sessionStatus, streaming, sendPrompt, wc.status]);

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
    [wc],
  );

  const agentPane = (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[11px] uppercase tracking-wider text-mist">
        <span>Agent</span>
        <span className="normal-case tracking-normal">
          {session.status === 'ready'
            ? `session ${session.sessionId?.slice(0, 8)}…`
            : session.status}
        </span>
      </div>

      <div
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {session.bootError && (
          <p className="text-sm text-ember">
            API bootstrap failed: {session.bootError}. Start the local backend
            (`cd infra-backend && npm run dev`) or set <code>VITE_API_URL</code>.
          </p>
        )}
        {session.status === 'booting' && session.messages.length === 0 && (
          <StreamingSkeleton />
        )}
        {session.messages.map((m) => (
          <MessageRow
            key={m.id}
            msg={m}
            streaming={
              session.streaming &&
              m.role === 'assistant' &&
              m.id.startsWith('stream-')
            }
          />
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
        {session.streaming &&
          !session.messages.some(
            (m) => m.role === 'assistant' && m.id.startsWith('stream-'),
          ) && <StreamingSkeleton />}
      </div>

      <form onSubmit={onSubmit} className="border-t border-line p-3" data-wc-tour="prompt">
        {template.examplePrompts.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {template.examplePrompts.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => applyChip(chip)}
                disabled={session.status !== 'ready' || session.streaming}
                className="interactive rounded-sm border border-line px-2 py-0.5 text-[10px] text-mist hover:border-signal/40 hover:text-paper disabled:opacity-40"
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
          className="field resize-none"
          disabled={session.status !== 'ready' || session.streaming}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-mist">
            {mode === 'build' ? 'Build: files + terminal' : 'Plan: memory tools only'}
          </p>
          <button
            type="submit"
            disabled={
              session.status !== 'ready' ||
              session.streaming ||
              !!session.pendingPlan ||
              !draft.trim()
            }
            className="btn-primary px-4 py-1.5 text-xs uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-40"
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
  );

  const previewPane = (
    <section className="flex h-full min-h-0 flex-col" data-wc-tour="preview">
      <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[11px] uppercase tracking-wider text-mist">
        <span>Preview</span>
        <span className="max-w-[50%] truncate normal-case tracking-normal">
          {wc.previewUrl ?? `WebContainer · ${wc.status}`}
        </span>
      </div>

      <div className="relative min-h-0 flex-1 bg-black/40">
        <PreviewBootOverlay phase={wc.bootPhase} />
        {wc.error && (
          <div className="absolute inset-0 z-10 grid place-items-center p-6 text-center text-sm text-ember">
            {wc.error}
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
      <BuilderWorkspaceTabs
        ship={
          <div className="divide-y divide-line">
            <DeployPanel
              deployments={deployState.deployments}
              busy={deployState.busy}
              error={deployState.error}
              onDeploy={() => void deployState.deploy(deployDisabled || session.streaming)}
              disabled={deployDisabled || session.streaming}
              embedded
              hideButton
            />
            <GithubPanel
              projectId={projectId}
              listFiles={wc.listFiles}
              syncNow={syncNow}
              embedded
            />
          </div>
        }
        data={
          <div className="divide-y divide-line">
            <DatabasePanel
              projectId={projectId}
              onScaffoldFiles={scaffoldFiles}
              embedded
            />
            <SecretsPanel projectId={projectId} embedded />
            <SignInPanel onScaffold={scaffoldFiles} embedded />
          </div>
        }
        versions={
          <CheckpointPanel
            projectId={projectId}
            sessionId={session.sessionId}
            listFiles={wc.listFiles}
            applySnapshot={(files) => wc.applySnapshot(files)}
            refreshKey={session.checkpointRefresh}
            embedded
          />
        }
      />
    </section>
  );

  return (
    <AppShell wide>
      <div className="flex h-full min-h-0 flex-col">
        <CoachMarkTour />
        <BuilderHeader
          projectName={projectName}
          templateName={template.name}
          mode={mode}
          onModeChange={setMode}
          streaming={session.streaming}
          onCancelStream={session.cancelGeneration}
          onNewSession={() => void session.newSession()}
          onDeploy={() => void deployState.deploy(deployDisabled || session.streaming)}
          deployBusy={deployState.busy}
          deployDisabled={deployDisabled || session.streaming}
          latestDeployUrl={deployState.latest?.url}
        />
        <ResizableSplitPane left={agentPane} right={previewPane} />
      </div>
    </AppShell>
  );
}
