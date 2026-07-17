import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSession,
  getLatestSession,
  getSession,
  streamPlanDecision,
  streamPrompt,
  streamToolResult,
} from '../api/client';
import type { AgentEvent, AgentMode, ChatMessage, PendingPlan } from '../api/types';

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
  onAfterFileTurn?: (sessionId: string) => Promise<void>,
) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [status, setStatus] = useState<'booting' | 'ready' | 'error'>('booting');
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [activityRefresh, setActivityRefresh] = useState(0);
  const [checkpointRefresh, setCheckpointRefresh] = useState(0);
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
        } else if (event.type === 'memory_recalled') {
          setMessages((prev) => [
            ...prev,
            {
              id: uid(),
              role: 'system',
              content: `Recalled ${event.count} memor${event.count === 1 ? 'y' : 'ies'} from CockroachDB`,
            },
          ]);
        } else if (event.type === 'plan_preview') {
          setPendingPlan({ planId: event.planId, files: event.files });
        } else if (event.type === 'plan_awaiting_approval') {
          setPendingPlan((prev) =>
            prev?.planId === event.planId ? prev : { planId: event.planId, files: [] },
          );
        } else if (event.type === 'tool_call') {
          setMessages((prev) => [
            ...prev,
            {
              id: uid(),
              role: 'tool',
              content: `${event.tool}${event.awaitResult ? ' (await)' : ''}`,
              tool: event.tool,
              awaitResult: event.awaitResult,
            },
          ]);

          const act = actionsRef.current;
          if (event.tool === 'write_file' || event.tool === 'edit_file') {
            hadFileWrites.current = true;
          }
          if (event.tool === 'write_file') {
            await act.applyWriteFile(
              String(event.args.path ?? ''),
              String(event.args.content ?? ''),
            );
          } else if (event.tool === 'edit_file') {
            await act.applyEditFile(
              String(event.args.path ?? ''),
              String(event.args.old_str ?? ''),
              String(event.args.new_str ?? ''),
            );
          } else if (event.tool === 'run_terminal' && event.awaitResult) {
            const cmd = String(event.args.cmd ?? '');
            const result = await act.applyTerminal(cmd);
            assistantBuf.current = '';
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
          }
        } else if (event.type === 'error') {
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: 'system', content: `Error: ${event.message}` },
          ]);
        } else if (event.type === 'done') {
          assistantBuf.current = '';
          if (event.reason !== 'awaiting_plan_approval') {
            setPendingPlan(null);
          }
          setActivityRefresh((n) => n + 1);
          if (
            event.reason === 'complete' &&
            hadFileWrites.current &&
            modeRef.current === 'build'
          ) {
            hadFileWrites.current = false;
            void onAfterFileTurnRef.current?.(sid).then(() => {
              setCheckpointRefresh((n) => n + 1);
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
        if (detail.pendingTool.tool !== 'run_terminal') return;

        pendingResumed.current = true;
        setStreaming(true);
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'system',
            content: `Resuming pending tool: ${detail.pendingTool!.tool}`,
          },
        ]);

        const cmd = String(detail.pendingTool.args.cmd ?? '');
        const result = await actionsRef.current.applyTerminal(cmd);
        await handleEvents(
          streamToolResult(sessionId, {
            projectId,
            toolCallId: detail.pendingTool.toolCallId,
            ok: result.ok,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
          }),
          sessionId,
          projectId,
        );
      } catch (err) {
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

  const sendPrompt = useCallback(
    async (message: string) => {
      if (!sessionId || !projectId || streaming || pendingPlan) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setStreaming(true);
      assistantBuf.current = '';
      hadFileWrites.current = false;
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'user', content: message },
      ]);
      try {
        await handleEvents(
          streamPrompt(sessionId, { message, projectId, mode }, ac.signal),
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
        setStreaming(false);
      }
    },
    [sessionId, projectId, streaming, pendingPlan, mode, handleEvents],
  );

  const cancelGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    assistantBuf.current = '';
    setStreaming(false);
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: 'system', content: 'Generation stopped.' },
    ]);
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
        setStreaming(false);
        if (decision !== 'approve') {
          setPendingPlan(null);
        }
      }
    },
    [sessionId, projectId, pendingPlan, streaming, handleEvents],
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
    sendPrompt,
    submitPlanDecision,
    cancelGeneration,
    newSession,
  };
}
