import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createProject,
  createSession,
  getSession,
  streamPrompt,
  streamToolResult,
} from '../api/client';
import type { AgentEvent, AgentMode, ChatMessage } from '../api/types';

const STORAGE_KEY = 'walkcroach.session.v1';

type StoredSession = {
  projectId: string;
  sessionId: string;
  projectName: string;
};

function loadStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

function saveStored(s: StoredSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
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

export function useAgentSession(
  projectName: string,
  mode: AgentMode,
  actions: FileActions,
  workspaceReady: boolean,
) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [status, setStatus] = useState<'booting' | 'ready' | 'error'>('booting');
  const assistantBuf = useRef('');
  const pendingResumed = useRef(false);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const handleEvents = useCallback(
    async (
      events: AsyncIterable<AgentEvent>,
      sid: string,
      pid: string,
    ): Promise<void> => {
      for await (const event of events) {
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
              }),
              sid,
              pid,
            );
          }
        } else if (event.type === 'error') {
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: 'system', content: `Error: ${event.message}` },
          ]);
        } else if (event.type === 'done') {
          assistantBuf.current = '';
        }
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = loadStored();
        if (existing?.projectId && existing?.sessionId) {
          try {
            const detail = await getSession(existing.sessionId);
            if (cancelled) return;
            setProjectId(detail.projectId);
            setSessionId(detail.id);
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
          } catch {
            localStorage.removeItem(STORAGE_KEY);
          }
        }

        const project = await createProject(projectName);
        const session = await createSession(project.id);
        saveStored({
          projectId: project.id,
          sessionId: session.id,
          projectName,
        });
        if (!cancelled) {
          setProjectId(project.id);
          setSessionId(session.id);
          setStatus('ready');
          setMessages([
            {
              id: uid(),
              role: 'system',
              content:
                'Session ready. Preferences and build decisions will persist in CockroachDB.',
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
  }, [projectName]);

  // Resume pending shell tool after WebContainer is ready (Phase 3.9).
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
      if (!sessionId || !projectId || streaming) return;
      setStreaming(true);
      assistantBuf.current = '';
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'user', content: message },
      ]);
      try {
        await handleEvents(
          streamPrompt(sessionId, { message, projectId, mode }),
          sessionId,
          projectId,
        );
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'system',
            content: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ]);
      } finally {
        setStreaming(false);
      }
    },
    [sessionId, projectId, streaming, mode, handleEvents],
  );

  const newSession = useCallback(async () => {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  }, []);

  return {
    projectId,
    sessionId,
    messages,
    streaming,
    status,
    bootError,
    sendPrompt,
    newSession,
  };
}
