import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createCheckpoint, patchProject } from '../api/client';
import type { AgentMode } from '../api/types';
import { AppShell } from '../components/AppShell';
import { SignInPanel } from '../features/backend/SignInPanel';
import { DatabasePanel } from '../features/backend/DatabasePanel';
import { SecretsPanel } from '../features/backend/SecretsPanel';
import { BuilderHeader } from '../features/builder/BuilderHeader';
import { BuilderStatusBar } from '../features/builder/BuilderStatusBar';
import { BuilderWorkspaceTabs } from '../features/builder/BuilderWorkspaceTabs';
import { CodeDrawer } from '../features/builder/CodeDrawer';
import { OpenInIdeChecklist } from '../features/builder/OpenInIdeChecklist';
import { PreviewBootOverlay } from '../features/builder/PreviewBootOverlay';
import { ResizableSplitPane } from '../features/builder/ResizableSplitPane';
import { TerminalDrawer } from '../features/builder/TerminalDrawer';
import { CheckpointPanel } from '../features/checkpoints/CheckpointPanel';
import { MessageRow, StreamingSkeleton } from '../features/chat/MessageRow';
import { DeployPanel } from '../features/deploy/DeployPanel';
import { useDeploy } from '../features/deploy/useDeploy';
import { GithubPanel } from '../features/github/GithubPanel';
import { BuilderMemoryStrip } from '../features/memory/BuilderMemoryStrip';
import { CoachMarkTour } from '../features/onboarding/CoachMarkTour';
import { TemplateGallery } from '../features/onboarding/TemplateGallery';
import { PlanReviewCard } from '../features/plan/PlanReviewCard';
import { PreviewBridge } from '../features/visual/PreviewBridge';
import { useAgentSession } from '../hooks/useAgentSession';
import { useBuilderSandbox } from '../hooks/useBuilderSandbox';
import { useFileSync } from '../hooks/useFileSync';
import { humanizeBuilderError } from '../lib/builderCopy';
import { rememberBuilderProject } from '../lib/lastBuilderProject';
import { consumePendingPrompt } from '../lib/pending-prompt';
import { getTemplate } from '../templates';

const DEV_MODE_KEY = 'walkcroach.builder.devMode';

function starterDismissKey(projectId: string): string {
  return `walkcroach.builder.starter.${projectId}`;
}

function needsStarterPrompt(templateId: string | null | undefined): boolean {
  return !templateId || templateId === 'blank';
}

type BuilderPageProps = {
  projectId: string;
  projectName: string;
  templateId: string | null;
};

function readDevMode(): boolean {
  try {
    return localStorage.getItem(DEV_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function BuilderPage({ projectId, projectName, templateId }: BuilderPageProps) {
  const [mode, setMode] = useState<AgentMode>('build');
  const [draft, setDraft] = useState('');
  const [canvasMode, setCanvasMode] = useState<'preview' | 'files'>(() =>
    readDevMode() ? 'files' : 'preview',
  );
  const [terminalOpen, setTerminalOpen] = useState(() => readDevMode());
  const [terminalUnread, setTerminalUnread] = useState(0);
  const [focusMode, setFocusMode] = useState(true);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(
    templateId,
  );
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [ideChecklistOpen, setIdeChecklistOpen] = useState(false);
  const initialPromptRef = useRef(consumePendingPrompt());
  const sentInitialRef = useRef(false);
  const lastLogLenRef = useRef(0);
  const template = getTemplate(activeTemplateId);
  const scheduleSyncRef = useRef<() => void>(() => {});

  useEffect(() => {
    rememberBuilderProject(projectId);
  }, [projectId]);

  useEffect(() => {
    setActiveTemplateId(templateId);
  }, [templateId]);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = !!sessionStorage.getItem(starterDismissKey(projectId));
    } catch {
      dismissed = false;
    }
    if (needsStarterPrompt(activeTemplateId) && !dismissed) {
      setGalleryOpen(true);
    }
  }, [projectId, activeTemplateId]);

  const sandbox = useBuilderSandbox(
    projectId,
    projectName,
    activeTemplateId,
    () => scheduleSyncRef.current(),
  );
  const { scheduleSync, syncNow } = useFileSync(
    projectId,
    sandbox.listFiles,
    sandbox.status === 'ready',
  );
  scheduleSyncRef.current = scheduleSync;

  const deployState = useDeploy(projectId, projectName, sandbox.listFiles, syncNow);
  const deployDisabled = sandbox.status !== 'ready';
  const applyTerminal = sandbox.applyTerminal;

  const handleAfterFileTurn = useCallback(
    async (sessionId: string): Promise<string | void> => {
      const files = await syncNow();
      if (files.length === 0) return;
      await createCheckpoint(projectId, {
        auto: true,
        sessionId,
        files,
        summary: 'Auto checkpoint after build turn',
      });
      // Soft IDE-style verify (recipes in .walkcroach/verify.json).
      try {
        const result = await applyTerminal('npm run build');
        if (result.ok) {
          return 'Verify passed · npm run build';
        }
        const detail = (result.stderr || result.stdout || '').trim().slice(0, 180);
        return `Verify failed · npm run build (exit ${result.exitCode})${
          detail ? ` — ${detail}` : ''
        }. Open Terminal for full output.`;
      } catch (err) {
        return `Verify skipped: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    [projectId, syncNow, applyTerminal],
  );

  const actions = useMemo(
    () => ({
      applyWriteFile: sandbox.applyWriteFile,
      applyEditFile: sandbox.applyEditFile,
      applyTerminal: sandbox.applyTerminal,
    }),
    [sandbox.applyWriteFile, sandbox.applyEditFile, sandbox.applyTerminal],
  );
  const session = useAgentSession(
    projectId,
    projectName,
    mode,
    actions,
    sandbox.status === 'ready',
    handleAfterFileTurn,
  );
  const { status: sessionStatus, streaming, sendPrompt } = session;

  useEffect(() => {
    const initialPrompt = initialPromptRef.current?.prompt;
    if (!initialPrompt || sentInitialRef.current) return;
    if (sessionStatus !== 'ready' || sandbox.status !== 'ready' || streaming) return;
    sentInitialRef.current = true;
    void sendPrompt(initialPrompt);
  }, [sessionStatus, streaming, sendPrompt, sandbox.status]);

  useEffect(() => {
    const len = sandbox.logs.length;
    if (terminalOpen) {
      lastLogLenRef.current = len;
      setTerminalUnread(0);
      return;
    }
    const delta = Math.max(0, len - lastLogLenRef.current);
    if (delta > 0) setTerminalUnread(delta);
  }, [sandbox.logs.length, terminalOpen]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (
      !text ||
      session.status !== 'ready' ||
      session.pendingPlan ||
      sandbox.status !== 'ready'
    ) {
      return;
    }
    setDraft('');
    void session.sendPrompt(text);
  };

  const applyChip = (text: string) => {
    if (
      session.status !== 'ready' ||
      session.pendingPlan ||
      sandbox.status !== 'ready'
    ) {
      return;
    }
    if (session.streaming) {
      void session.sendPrompt(text);
      return;
    }
    setDraft(text);
  };

  const applyScopedPrompt = (text: string) => {
    if (session.status !== 'ready' || sandbox.status !== 'ready') return;
    void session.sendPrompt(text);
  };

  const scaffoldFiles = useCallback(
    (files: Record<string, string>) => {
      for (const [path, content] of Object.entries(files)) {
        void sandbox.applyWriteFile(path, content);
      }
    },
    [sandbox],
  );

  const toggleTerminal = () => {
    setTerminalOpen((v) => {
      const next = !v;
      if (next) {
        lastLogLenRef.current = sandbox.logs.length;
        setTerminalUnread(0);
      }
      return next;
    });
  };

  const markStarterDismissed = useCallback(
    (id: string) => {
      try {
        sessionStorage.setItem(starterDismissKey(projectId), id);
      } catch {
        /* ignore */
      }
    },
    [projectId],
  );

  const applyStarter = useCallback(
    async (nextTemplateId: string) => {
      if (applyingTemplate) return;
      setApplyingTemplate(true);
      setTemplateError(null);
      try {
        await patchProject(projectId, { templateId: nextTemplateId });
        markStarterDismissed(nextTemplateId);
        // Changing templateId remounts the E2B scaffold (server force/mismatch).
        setActiveTemplateId(nextTemplateId);
        setGalleryOpen(false);
      } catch (err) {
        setTemplateError(err instanceof Error ? err.message : String(err));
      } finally {
        setApplyingTemplate(false);
      }
    },
    [applyingTemplate, markStarterDismissed, projectId],
  );

  const dismissStarterGallery = useCallback(() => {
    if (applyingTemplate) return;
    markStarterDismissed(activeTemplateId ?? 'blank');
    setGalleryOpen(false);
  }, [activeTemplateId, applyingTemplate, markStarterDismissed]);

  const runtimeLabel =
    sandbox.runtime === 'e2b' ? 'E2B cloud' : 'Local preview';

  const agentPane = (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[11px] uppercase tracking-wider text-mist">
        <span>Chat</span>
        <span className="normal-case tracking-normal">
          {session.status === 'ready'
            ? `session ${session.sessionId?.slice(0, 8)}…`
            : session.status}
        </span>
      </div>

      <BuilderMemoryStrip
        projectId={projectId}
        refreshKey={session.activityRefresh}
      />

      <div
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {session.bootError && (
          <p className="rounded-[var(--radius-control)] border border-ember/30 bg-ember/10 px-3 py-2 text-sm text-paper">
            {humanizeBuilderError(session.bootError)}
          </p>
        )}
        {session.status === 'booting' && session.messages.length === 0 && (
          <StreamingSkeleton />
        )}
        {session.messages.length === 0 &&
          session.status === 'ready' &&
          !session.bootError && (
            <div className="rounded-[var(--radius-surface)] border border-line/80 bg-panel/40 px-4 py-5">
              <p className="font-display text-base font-bold text-paper">
                Describe what to build
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-mist">
                The preview stays on the right. Terminal and Code stay closed until
                you need them.
              </p>
            </div>
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
            saveContext={{
              projectId,
              sessionId: session.sessionId,
            }}
          />
        ))}
        {session.pendingPlan && (
          <PlanReviewCard
            plan={session.pendingPlan}
            disabled={session.streaming}
            onApprove={() => void session.submitPlanDecision('approve')}
            onApproveEdited={(edited) => void session.approveEditedPlan(edited)}
            onAdjust={(feedback) =>
              void session.submitPlanDecision('adjust', feedback)
            }
            onCancel={() => void session.submitPlanDecision('cancel')}
            onPlanEdited={(edited) =>
              session.persistPlanMarkdown(session.pendingPlan!.planId, edited)
            }
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
                disabled={
                  session.status !== 'ready' ||
                  !!session.pendingPlan ||
                  sandbox.status !== 'ready'
                }
                className="interactive rounded-[var(--radius-control)] border border-line px-2 py-0.5 text-[10px] text-mist hover:border-signal/40 hover:text-paper disabled:opacity-40"
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
            session.streaming
              ? 'Agent is working — send to queue another prompt…'
              : mode === 'plan'
                ? 'Plan the app — no file writes yet…'
                : 'Build a muted landing page with a contact CTA…'
          }
          className="field resize-none"
          disabled={
            session.status !== 'ready' ||
            !!session.pendingPlan ||
            sandbox.status !== 'ready'
          }
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-mist">
            {sandbox.status !== 'ready'
              ? 'Waiting for sandbox…'
              : session.promptQueue.length > 0
                ? `Queued ${session.promptQueue.length}`
                : mode === 'build'
                  ? 'Build mode'
                  : 'Plan mode'}
            {session.promptQueue.length > 0 && (
              <>
                {' · '}
                <button
                  type="button"
                  className="text-ember hover:underline"
                  onClick={() => session.clearPromptQueue()}
                >
                  Clear queue
                </button>
              </>
            )}
          </p>
          <button
            type="submit"
            disabled={
              session.status !== 'ready' ||
              !!session.pendingPlan ||
              sandbox.status !== 'ready' ||
              !draft.trim()
            }
            className="btn-primary px-4 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
          >
            {session.streaming ? 'Queue' : 'Send'}
          </button>
        </div>
      </form>
    </section>
  );

  const previewPane = (
    <section className="flex h-full min-h-0 flex-col" data-wc-tour="preview">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-[11px] uppercase tracking-wider text-mist">
        <div
          className="flex overflow-hidden rounded-[var(--radius-control)] border border-line"
          role="tablist"
          aria-label="Canvas mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={canvasMode === 'preview'}
            onClick={() => setCanvasMode('preview')}
            className={`interactive px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              canvasMode === 'preview'
                ? 'bg-raised text-paper'
                : 'text-mist hover:text-paper'
            }`}
          >
            Preview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={canvasMode === 'files'}
            onClick={() => setCanvasMode('files')}
            className={`interactive px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              canvasMode === 'files'
                ? 'bg-raised text-paper'
                : 'text-mist hover:text-paper'
            }`}
          >
            Files
          </button>
        </div>
        <span className="max-w-[55%] truncate normal-case tracking-normal">
          {canvasMode === 'files'
            ? 'Project files'
            : (sandbox.previewUrl ?? `${runtimeLabel} · ${sandbox.status}`)}
        </span>
      </div>

      {canvasMode === 'preview' ? (
        <div className="relative min-h-0 flex-1 bg-black/40">
          {sandbox.status === 'booting' && (
            <PreviewBootOverlay
              phase={sandbox.bootPhase}
              runtime={sandbox.runtime}
            />
          )}
          {sandbox.error && (
            <div className="absolute inset-0 z-10 grid place-items-center p-6 text-center">
              <div className="max-w-sm rounded-[var(--radius-surface)] border border-ember/30 bg-ink/90 px-4 py-5">
                <p className="font-display text-sm font-bold text-paper">
                  Preview could not start
                </p>
                <p className="mt-2 text-sm leading-relaxed text-mist">
                  {humanizeBuilderError(sandbox.error)}
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    className="interactive rounded-[var(--radius-control)] bg-signal px-3 py-1.5 text-xs font-semibold text-ink"
                    onClick={() => sandbox.retryBoot()}
                  >
                    Retry preview
                  </button>
                  {sandbox.runtime === 'e2b' && (
                    <button
                      type="button"
                      className="interactive rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs text-paper"
                      onClick={() => void sandbox.refreshPreview()}
                    >
                      Refresh URL
                    </button>
                  )}
                </div>
                <p className="mt-3 text-[11px] text-mist/80">
                  Open Terminal for technical details.
                </p>
              </div>
            </div>
          )}
          {!sandbox.error &&
            !sandbox.previewUrl &&
            sandbox.status !== 'booting' &&
            sandbox.status !== 'idle' && (
              <div className="absolute inset-0 z-10 grid place-items-center p-6 text-center">
                <div className="max-w-sm rounded-[var(--radius-surface)] border border-line bg-ink/90 px-4 py-5">
                  <p className="font-display text-sm font-bold text-paper">
                    Preview not ready
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-mist">
                    The sandbox is up but no preview URL is available yet.
                  </p>
                  <button
                    type="button"
                    className="interactive mt-4 rounded-[var(--radius-control)] bg-signal px-3 py-1.5 text-xs font-semibold text-ink"
                    onClick={() => sandbox.retryBoot()}
                  >
                    Retry preview
                  </button>
                </div>
              </div>
            )}
          {sandbox.previewUrl && (
            <PreviewBridge
              projectId={projectId}
              previewUrl={sandbox.previewUrl}
              onApplyEdit={(path, oldStr, newStr) =>
                sandbox.applyEditFile(path, oldStr, newStr)
              }
              onReadFile={sandbox.readFile}
              onScopedPrompt={applyScopedPrompt}
              onFilesMutated={scheduleSync}
            />
          )}
        </div>
      ) : (
        <CodeDrawer
          open
          fill
          onClose={() => setCanvasMode('preview')}
          listFiles={sandbox.listFiles}
          onSave={(path, content) => sandbox.applyWriteFile(path, content)}
          refreshKey={session.activityRefresh + session.checkpointRefresh}
          ready={sandbox.status === 'ready'}
        />
      )}

      <TerminalDrawer
        open={terminalOpen}
        onToggle={toggleTerminal}
        logs={sandbox.logs}
        unread={terminalUnread}
      />

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
              listFiles={sandbox.listFiles}
              syncNow={syncNow}
              applySnapshot={(files) => sandbox.applySnapshot(files)}
              applyTerminal={sandbox.applyTerminal}
              refreshPreview={() => sandbox.refreshPreview()}
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
            listFiles={sandbox.listFiles}
            applySnapshot={(files) => sandbox.applySnapshot(files)}
            refreshKey={session.checkpointRefresh}
            embedded
          />
        }
      />

      <BuilderStatusBar
        sessionId={session.sessionId}
        activityRefresh={session.activityRefresh}
        runtimeLabel={runtimeLabel}
        previewReady={sandbox.status === 'ready' && !!sandbox.previewUrl}
        streaming={session.streaming}
        terminalOpen={terminalOpen}
        terminalUnread={terminalUnread}
        onToggleTerminal={toggleTerminal}
      />
    </section>
  );

  return (
    <AppShell wide>
      <div className="flex h-full min-h-0 flex-col">
        <CoachMarkTour />
        {!focusMode && (
          <div className="border-b border-line bg-raised/50 px-4 py-1.5 text-[11px] text-mist">
            Focus mode off —{' '}
            <Link to="/app/chat" className="text-signal hover:underline">
              Chat
            </Link>
            {' · '}
            <Link to="/app/projects" className="text-signal hover:underline">
              Projects
            </Link>
          </div>
        )}
        {templateError && (
          <p className="border-b border-ember/30 bg-ember/10 px-4 py-2 text-sm text-ember">
            {templateError}
          </p>
        )}
        <BuilderHeader
          projectId={projectId}
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
          focusMode={focusMode}
          onToggleFocus={() => setFocusMode((v) => !v)}
          onChooseStarter={() => setGalleryOpen(true)}
          onOpenInIde={() => setIdeChecklistOpen(true)}
        />
        <ResizableSplitPane
          left={agentPane}
          right={previewPane}
          defaultLeftPercent={20}
        />
        <TemplateGallery
          open={galleryOpen}
          creating={applyingTemplate}
          onClose={dismissStarterGallery}
          onSelect={(id) => void applyStarter(id)}
          title="Choose a starter"
          description="App Builder templates mount in the sandbox. Projects stay a chat + knowledge container — starters live here."
        />
        <OpenInIdeChecklist
          open={ideChecklistOpen}
          onClose={() => setIdeChecklistOpen(false)}
          projectId={projectId}
          projectName={projectName}
          listFiles={sandbox.listFiles}
          syncNow={syncNow}
        />
      </div>
    </AppShell>
  );
}
