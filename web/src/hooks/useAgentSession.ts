import { useCallback, useEffect, useRef, useState, startTransition } from 'react';
import {
  createSession,
  getLatestSession,
  getSession,
  streamPlanDecision,
  streamPrompt,
  streamToolResult,
} from '../api/client';
import type { AgentEvent, AgentMode, ChatMessage, PendingPlan, PlanFile } from '../api/types';
import {
  formatEditedPlanAdjustment,
  formatPlanMarkdown,
} from '../features/plan/planMarkdown';

function storageKey(projectId: string): string {
  return `walkcroach.session.v1.${projectId}`;
}

type StoredSession = {
  projectId: string;
  sessionId: string;
};

function loadStored(projectId: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (parsed.projectId !== projectId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveStored(s: StoredSession): void {
  localStorage.setItem(storageKey(s.projectId), JSON.stringify(s));
}

function uid(): string {
  return crypto.randomUUID();
}

type FileActions = {
  applyWriteFile: (path: string, content: string) => Promise<void>;
  applyEditFile: (
    path: string,
    oldStr: string,
    newStr: string,
  ) => Promise<void>;
  applyTerminal: (cmd: string) => Promise<{
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
};

function storedToChat(
  messages: Array<{ id: string; role: string; content: string }>,
): ChatMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role:
      m.role === 'user' || m.role === 'assistant' || m.role === 'tool'
        ? m.role
        : 'system',
    content: m.content || `(${m.role})`,
  }));
}

function hydratePendingPlan(detail: {
  status: string;
  pendingTool: {
    tool: string;
    args: Record<string, unknown>;
    files?: Array<{ path: string; reason: string }>;
  } | null;
}): PendingPlan | null {
  if (detail.status !== 'awaiting_plan_approval' || !detail.pendingTool) return null;
  if (detail.pendingTool.tool !== 'plan_approval') return null;
  const planId = String(detail.pendingTool.args.planId ?? '');
  const files =
    detail.pendingTool.files ??
    (detail.pendingTool.args.files as Array<{ path: string; reason: string }>) ??
    [];
  if (!planId) return null;
  return { planId, files };
}

export function useAgentSession(
  projectId: string,
  projectName: string,
  mode: AgentMode,
  actions: FileActions,
  workspaceReady: boolean,
  onAfterFileTurn?: (sessionId: string) => Promise<string | void>,
) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [status, setStatus] = useState<'booting' | 'ready' | 'error'>('booting');
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [activityRefresh, setActivityRefresh] = useState(0);
  const [checkpointRefresh, setCheckpointRefresh] = useState(0);
  const [promptQueue, setPromptQueue] = useState<string[]>([]);
  const assistantBuf = useRef('');
  const hadFileWrites = useRef(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onAfterFileTurnRef = useRef(onAfterFileTurn);
  onAfterFileTurnRef.current = onAfterFileTurn;
  const pendingResumed = useRef(false);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const abortRef = useRef<AbortController | null>(null);
  const promptQueueRef = useRef<string[]>([]);
  promptQueueRef.current = promptQueue;
  const streamingRef = useRef(false);
  const awaitingPlanRef = useRef(false);
  /** Bumped on Stop so in-flight tool handlers defer to cancelGeneration's tool-result. */
  const cancelEpochRef = useRef(0);
  /** Client tool currently awaiting POST /tool-result (clear on Stop). */
  const inflightToolRef = useRef<{
    sessionId: string;
    projectId: string;
    toolCallId: string;
  } | null>(null);

  const handleEvents = useCallback(
    async (
      events: AsyncIterable<AgentEvent>,
      sid: string,
      pid: string,
      signal?: AbortSignal,
    ): Promise<void> => {
      for await (const event of events) {
        if (signal?.aborted) break;
        if (event.type === 'token') {
          assistantBuf.current += event.text;
          const text = assistantBuf.current;
          startTransition(() => {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant' && last.id.startsWith('stream-')) {
                return [...prev.slice(0, -1), { ...last, content: text }];
              }
              return [
                ...prev,
                { id: `stream-${uid()}`, role: 'assistant', content: text },
              ];
            });
          });
        } else if (event.type === 'memory_recalled') {
          setMessages((prev) => [
            ...prev,
            {
              id: uid(),
              role: 'system',
              content:
                event.count === 0
                  ? 'No project memories recalled'
                  : `Recalled ${event.count} memor${event.count === 1 ? 'y' : 'ies'} from CockroachDB`,
              memoryHits: event.hits,
            },
          ]);
        } else if (event.type === 'plan_preview') {
          awaitingPlanRef.current = true;
          setPendingPlan({ planId: event.planId, files: event.files });
          // Persist durable plan.md into the sandbox (Metaphor A / Lovable parity).
          void actionsRef.current
            .applyWriteFile(
              'plan.md',
              formatPlanMarkdown(event.planId, event.files),
            )
            .catch(() => {
              /* best-effort — approval UI still works */
            });
        } else if (event.type === 'plan_awaiting_approval') {
          setPendingPlan((prev) =>
            prev?.planId === event.planId ? prev : { planId: event.planId, files: [] },
          );
        } else if (event.type === 'tool_call') {
          // Finalize in-progress assistant text so the caret doesn't look stuck
          // while client tools (ls, npm, …) run in the background.
          const toolMsgId = uid();
          setMessages((prev) => {
            const finalized = prev.map((m) =>
              m.role === 'assistant' && m.id.startsWith('stream-')
                ? { ...m, id: uid() }
                : m,
            );
            return [
              ...finalized,
              {
                id: toolMsgId,
                role: 'tool' as const,
                content: event.tool,
                tool: event.tool,
                awaitResult: event.awaitResult,
              },
            ];
          });

          const markToolDone = () => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === toolMsgId
                  ? { ...m, awaitResult: false, content: event.tool }
                  : m,
              ),
            );
          };

          const act = actionsRef.current;
          if (event.tool === 'write_file' || event.tool === 'edit_file') {
            hadFileWrites.current = true;
          }
          if (
            (event.tool === 'write_file' || event.tool === 'edit_file') &&
            event.awaitResult !== false
          ) {
            const epochAtStart = cancelEpochRef.current;
            inflightToolRef.current = {
              sessionId: sid,
              projectId: pid,
              toolCallId: event.id,
            };
            let ok = true;
            let stderr = '';
            try {
              if (event.tool === 'write_file') {
                await act.applyWriteFile(
                  String(event.args.path ?? ''),
                  String(event.args.content ?? ''),
                );
              } else {
                await act.applyEditFile(
                  String(event.args.path ?? ''),
                  String(event.args.old_str ?? ''),
                  String(event.args.new_str ?? ''),
                );
              }
            } catch (err) {
              ok = false;
              stderr = err instanceof Error ? err.message : String(err);
            }
            markToolDone();
            // Stop owns the tool-result when cancelEpoch advanced.
            if (cancelEpochRef.current !== epochAtStart) {
              return;
            }
            assistantBuf.current = '';
            try {
              await handleEvents(
                streamToolResult(
                  sid,
                  {
                    projectId: pid,
                    toolCallId: event.id,
                    ok,
                    stdout: ok
                      ? `Applied ${event.tool} on ${String(event.args.path ?? 'file')}`
                      : '',
                    stderr,
                  },
                  signal,
                ),
                sid,
                pid,
                signal,
              );
            } finally {
              if (inflightToolRef.current?.toolCallId === event.id) {
                inflightToolRef.current = null;
              }
            }
          } else if (
            event.tool === 'run_terminal' &&
            event.awaitResult !== false
          ) {
            const epochAtStart = cancelEpochRef.current;
            inflightToolRef.current = {
              sessionId: sid,
              projectId: pid,
              toolCallId: event.id,
            };
            const cmd = String(event.args.cmd ?? '');
            const result = await act.applyTerminal(cmd);
            markToolDone();
            if (cancelEpochRef.current !== epochAtStart) {
              return;
            }
            assistantBuf.current = '';
            try {
              await handleEvents(
                streamToolResult(sid, {
                  projectId: pid,
                  toolCallId: event.id,
                  ok: result.ok,
                  exitCode: result.exitCode,
                  stdout: result.stdout,
                  stderr: result.stderr,
                }, signal),
                sid,
                pid,
                signal,
              );
            } finally {
              if (inflightToolRef.current?.toolCallId === event.id) {
                inflightToolRef.current = null;
              }
            }
          } else {
            markToolDone();
          }
        } else if (event.type === 'warning') {
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: 'system', content: event.message },
          ]);
        } else if (event.type === 'error') {
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: 'system', content: `Error: ${event.message}` },
          ]);
        } else if (event.type === 'done') {
          assistantBuf.current = '';
          if (event.reason !== 'awaiting_plan_approval') {
            awaitingPlanRef.current = false;
            setPendingPlan(null);
          } else {
            awaitingPlanRef.current = true;
          }
          setActivityRefresh((n) => n + 1);
          if (event.reason === 'stuck_tool_loop') {
            setMessages((prev) => [
              ...prev,
              {
                id: uid(),
                role: 'system',
                content:
                  'Stopped: the agent was retrying the same failing command. Change the approach or try a different prompt.',
              },
            ]);
          }
          if (
            event.reason === 'complete' &&
            hadFileWrites.current &&
            modeRef.current === 'build'
          ) {
            hadFileWrites.current = false;
            void onAfterFileTurnRef.current?.(sid).then((note) => {
              setCheckpointRefresh((n) => n + 1);
              if (note) {
                setMessages((prev) => [
                  ...prev,
                  { id: uid(), role: 'system', content: note },
                ]);
              }
            });
          }
        }
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = loadStored(projectId);
        if (existing?.sessionId) {
          try {
            const detail = await getSession(existing.sessionId);
            if (cancelled) return;
            if (detail.projectId !== projectId) {
              localStorage.removeItem(storageKey(projectId));
            } else {
              setSessionId(detail.id);
              setPendingPlan(hydratePendingPlan(detail));
              setMessages([
                {
                  id: uid(),
                  role: 'system',
                  content: `Resumed session ${detail.id.slice(0, 8)}… — hydrated from CockroachDB.`,
                },
                ...storedToChat(detail.messages),
              ]);
              setStatus('ready');
              return;
            }
          } catch {
            localStorage.removeItem(storageKey(projectId));
          }
        }

        try {
          const latest = await getLatestSession(projectId);
          if (!cancelled && latest.sessionId) {
            const detail = await getSession(latest.sessionId);
            if (!cancelled && detail.projectId === projectId) {
              saveStored({ projectId, sessionId: detail.id });
              setSessionId(detail.id);
              setPendingPlan(hydratePendingPlan(detail));
              setMessages([
                {
                  id: uid(),
                  role: 'system',
                  content: `Continued latest session ${detail.id.slice(0, 8)}…`,
                },
                ...storedToChat(detail.messages),
              ]);
              setStatus('ready');
              return;
            }
          }
        } catch {
          /* no sessions yet — create below */
        }

        const session = await createSession(projectId);
        saveStored({ projectId, sessionId: session.id });
        if (!cancelled) {
          setSessionId(session.id);
          setStatus('ready');
          setMessages([
            {
              id: uid(),
              role: 'system',
              content: `Session ready for ${projectName}. Preferences and build decisions persist in CockroachDB.`,
            },
          ]);
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setBootError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, projectName]);

  useEffect(() => {
    if (!workspaceReady || !sessionId || !projectId || pendingResumed.current) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const detail = await getSession(sessionId);
        if (cancelled || detail.status !== 'awaiting_tool' || !detail.pendingTool) {
          return;
        }
        const tool = detail.pendingTool.tool;
        if (
          tool !== 'run_terminal' &&
          tool !== 'write_file' &&
          tool !== 'edit_file'
        ) {
          return;
        }

        pendingResumed.current = true;
        setStreaming(true);
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'system',
            content: `Resuming pending tool: ${tool}`,
          },
        ]);

        const act = actionsRef.current;
        const args = detail.pendingTool.args;
        inflightToolRef.current = {
          sessionId,
          projectId,
          toolCallId: detail.pendingTool.toolCallId,
        };
        let ok = true;
        let exitCode: number | undefined;
        let stdout = '';
        let stderr = '';
        try {
          if (tool === 'run_terminal') {
            const result = await act.applyTerminal(String(args.cmd ?? ''));
            ok = result.ok;
            exitCode = result.exitCode;
            stdout = result.stdout;
            stderr = result.stderr;
          } else if (tool === 'write_file') {
            await act.applyWriteFile(
              String(args.path ?? ''),
              String(args.content ?? ''),
            );
            stdout = `Applied write_file on ${String(args.path ?? 'file')}`;
          } else {
            await act.applyEditFile(
              String(args.path ?? ''),
              String(args.old_str ?? ''),
              String(args.new_str ?? ''),
            );
            stdout = `Applied edit_file on ${String(args.path ?? 'file')}`;
          }
        } catch (err) {
          ok = false;
          stderr = err instanceof Error ? err.message : String(err);
        }

        try {
          await handleEvents(
            streamToolResult(sessionId, {
              projectId,
              toolCallId: detail.pendingTool.toolCallId,
              ok,
              exitCode,
              stdout,
              stderr,
            }),
            sessionId,
            projectId,
          );
        } finally {
          if (
            inflightToolRef.current?.toolCallId ===
            detail.pendingTool.toolCallId
          ) {
            inflightToolRef.current = null;
          }
        }
      } catch (err) {
        pendingResumed.current = false;
        if (!cancelled) {
          setMessages((prev) => [
            ...prev,
            {
              id: uid(),
              role: 'system',
              content: `Pending tool resume failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ]);
        }
      } finally {
        if (!cancelled) setStreaming(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceReady, sessionId, projectId, handleEvents]);

  const runPromptTurn = useCallback(
    async (message: string) => {
      if (!sessionId || !projectId) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      streamingRef.current = true;
      setStreaming(true);
      assistantBuf.current = '';
      hadFileWrites.current = false;
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'user', content: message },
      ]);
      try {
        await handleEvents(
          streamPrompt(
            sessionId,
            { message, projectId, mode: modeRef.current },
            ac.signal,
          ),
          sessionId,
          projectId,
          ac.signal,
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'system',
            content: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ]);
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
        streamingRef.current = false;
        setStreaming(false);
        // Drain prompt queue after a completed (non-aborted) turn.
        // Never drain while a multi-file plan is awaiting approval.
        if (!ac.signal.aborted && !awaitingPlanRef.current) {
          const next = promptQueueRef.current[0];
          if (next) {
            const rest = promptQueueRef.current.slice(1);
            promptQueueRef.current = rest;
            setPromptQueue(rest);
            queueMicrotask(() => {
              void runPromptTurn(next);
            });
          }
        }
      }
    },
    [sessionId, projectId, handleEvents],
  );

  const sendPrompt = useCallback(
    async (message: string) => {
      if (!sessionId || !projectId || pendingPlan) return;
      const trimmed = message.trim();
      if (!trimmed) return;

      // Queue while a turn is in flight (Lovable-style prompt queue).
      if (streamingRef.current || streaming) {
        const next = [...promptQueueRef.current, trimmed];
        promptQueueRef.current = next;
        setPromptQueue(next);
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'system',
            content: `Queued (${next.length}): ${trimmed.length > 72 ? `${trimmed.slice(0, 72)}…` : trimmed}`,
          },
        ]);
        return;
      }

      await runPromptTurn(trimmed);
    },
    [sessionId, projectId, pendingPlan, streaming, runPromptTurn],
  );

  const clearPromptQueue = useCallback(() => {
    promptQueueRef.current = [];
    setPromptQueue([]);
  }, []);

  const persistPlanMarkdown = useCallback(
    (planId: string, files: PlanFile[]) => {
      void actionsRef.current
        .applyWriteFile('plan.md', formatPlanMarkdown(planId, files))
        .catch(() => undefined);
    },
    [],
  );

  const cancelGeneration = useCallback(() => {
    const pendingTool = inflightToolRef.current;
    cancelEpochRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    assistantBuf.current = '';
    pendingResumed.current = false;
    inflightToolRef.current = null;
    streamingRef.current = false;
    promptQueueRef.current = [];
    setPromptQueue([]);
    setStreaming(false);
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: 'system', content: 'Generation stopped.' },
    ]);
    // Clear harness awaiting_tool (and any queued siblings) so the next prompt works.
    if (pendingTool) {
      void (async () => {
        try {
          for await (const event of streamToolResult(pendingTool.sessionId, {
            projectId: pendingTool.projectId,
            toolCallId: pendingTool.toolCallId,
            ok: false,
            stderr: 'cancelled by user',
            cancelRemaining: true,
          })) {
            if (event.type === 'warning') {
              setMessages((prev) => [
                ...prev,
                { id: uid(), role: 'system', content: event.message },
              ]);
            }
          }
        } catch {
          /* best-effort clear */
        }
      })();
    }
  }, []);

  const submitPlanDecision = useCallback(
    async (
      decision: 'approve' | 'adjust' | 'cancel',
      adjustment?: string,
    ) => {
      if (!sessionId || !projectId || !pendingPlan || streaming) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      streamingRef.current = true;
      setStreaming(true);
      assistantBuf.current = '';
      try {
        await handleEvents(
          streamPlanDecision(sessionId, {
            projectId,
            planId: pendingPlan.planId,
            decision,
            adjustment,
          }, ac.signal),
          sessionId,
          projectId,
          ac.signal,
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'system',
            content: `Plan decision failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ]);
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
        streamingRef.current = false;
        setStreaming(false);
        // Adjust may emit a new plan_preview — do not wipe it.
        // Cancel always clears. Approve is cleared by the done handler.
        if (decision === 'cancel') {
          awaitingPlanRef.current = false;
          setPendingPlan(null);
        } else if (decision === 'adjust' && !awaitingPlanRef.current) {
          setPendingPlan(null);
        }
        if (!ac.signal.aborted && !awaitingPlanRef.current) {
          const next = promptQueueRef.current[0];
          if (next) {
            const rest = promptQueueRef.current.slice(1);
            promptQueueRef.current = rest;
            setPromptQueue(rest);
            queueMicrotask(() => {
              void runPromptTurn(next);
            });
          }
        }
      }
    },
    [sessionId, projectId, pendingPlan, streaming, handleEvents, runPromptTurn],
  );

  const approveEditedPlan = useCallback(
    async (edited: PlanFile[]) => {
      if (!pendingPlan) return;
      persistPlanMarkdown(pendingPlan.planId, edited);
      await submitPlanDecision(
        'adjust',
        formatEditedPlanAdjustment(pendingPlan.files, edited),
      );
    },
    [pendingPlan, persistPlanMarkdown, submitPlanDecision],
  );

  const newSession = useCallback(async () => {
    localStorage.removeItem(storageKey(projectId));
    window.location.reload();
  }, [projectId]);

  return {
    projectId,
    sessionId,
    messages,
    streaming,
    status,
    bootError,
    pendingPlan,
    activityRefresh,
    checkpointRefresh,
    promptQueue,
    sendPrompt,
    clearPromptQueue,
    submitPlanDecision,
    approveEditedPlan,
    persistPlanMarkdown,
    cancelGeneration,
    newSession,
  };
}
