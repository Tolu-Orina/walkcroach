import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSession,
  ensureChatWorkspace,
  getLatestSession,
  getSession,
  listChatSessions,
  streamPrompt,
} from '../api/client';
import type { AgentEvent, ChatMessage } from '../api/types';
import type { ChatAttachment } from '../features/chat/ChatComposer';

function uid(): string {
  return crypto.randomUUID();
}

function storageKey(workspaceId: string): string {
  return `walkcroach.chat.session.v1.${workspaceId}`;
}

function parseCitations(text: string): Array<{ title: string; url: string }> {
  const citations: Array<{ title: string; url: string }> = [];
  const urlRe = /https?:\/\/[^\s)\]>'"]+/g;
  const urls = text.match(urlRe) ?? [];
  for (const url of urls.slice(0, 8)) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      if (!citations.some((c) => c.url === url)) {
        citations.push({ title: host, url });
      }
    } catch {
      /* ignore bad url */
    }
  }
  return citations;
}

/** Hide Bedrock toolUse/toolResult plumbing from the Chat UI. */
function isToolPlumbingContent(content: string): boolean {
  const t = content.trim();
  if (!t) return true;
  if (/^\[tool_use\b/i.test(t)) return true;
  if (/^\[tool_result\]/i.test(t)) return true;
  // Entire body is only tool markers (multi-line)
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    lines.length > 0 &&
    lines.every(
      (l) => /^\[tool_use\b/i.test(l) || /^\[tool_result\]/i.test(l),
    )
  );
}

function storedToChat(
  messages: Array<{
    id: string;
    role: string;
    content: string;
    attachments?: Array<{
      name: string;
      mime: string;
      textPreview: string;
      byteSize?: number;
    }> | null;
    citations?: Array<{ title: string; url: string }> | null;
  }>,
): ChatMessage[] {
  return messages
    .filter((m) => {
      if (m.role === 'tool') return false;
      if (isToolPlumbingContent(m.content || '')) return false;
      return true;
    })
    .map((m) => ({
      id: m.id,
      role:
        m.role === 'user' || m.role === 'assistant' || m.role === 'tool'
          ? m.role
          : 'system',
      content: m.content || `(${m.role})`,
      attachments: m.attachments?.length ? m.attachments : undefined,
      citations:
        m.citations?.length
          ? m.citations
          : m.role === 'assistant'
            ? parseCitations(m.content || '')
            : undefined,
    }));
}

/** User-visible message only — no system instructions (avoids prompt leakage). */
function userMessageText(message: string): string {
  return message.trim();
}

/**
 * Chat session against a project workspace.
 * Omit projectId → personal Chat workspace (`__walkcroach_chat__`).
 * Pass projectId for project-scoped chats; switch threads via openSession(chatId).
 */
export function useChatSession(opts?: {
  projectId?: string;
}) {
  const fixedProjectId = opts?.projectId;
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    fixedProjectId ?? null,
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<'booting' | 'ready' | 'error'>('booting');
  const [bootError, setBootError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Array<{ id: string; title: string }>>(
    [],
  );
  const [webSearch, setWebSearch] = useState(true);
  const assistantBuf = useRef('');
  const abortRef = useRef<AbortController | null>(null);

  const refreshRecent = useCallback(async (wid: string) => {
    try {
      const sessions = await listChatSessions(wid);
      setRecent(sessions);
    } catch {
      setRecent([]);
    }
  }, []);

  const handleEvents = useCallback(
    async (events: AsyncIterable<AgentEvent>, signal: AbortSignal) => {
      for await (const event of events) {
        if (signal.aborted) break;
        if (event.type === 'token') {
          assistantBuf.current += event.text;
          const text = assistantBuf.current;
          setMessages((prev) => {
            const withoutStream = prev.filter((m) => m.id !== 'stream-assistant');
            return [
              ...withoutStream,
              {
                id: 'stream-assistant',
                role: 'assistant' as const,
                content: text,
              },
            ];
          });
        } else if (event.type === 'error') {
          setMessages((prev) => [
            ...prev.filter((m) => m.id !== 'stream-assistant'),
            {
              id: uid(),
              role: 'system',
              content: event.message,
            },
          ]);
        } else if (event.type === 'done') {
          const finalText = assistantBuf.current;
          assistantBuf.current = '';
          if (finalText) {
            setMessages((prev) => {
              const withoutStream = prev.filter(
                (m) => m.id !== 'stream-assistant',
              );
              return [
                ...withoutStream,
                {
                  id: uid(),
                  role: 'assistant',
                  content: finalText,
                  citations: parseCitations(finalText),
                },
              ];
            });
          } else {
            setMessages((prev) =>
              prev.filter((m) => m.id !== 'stream-assistant'),
            );
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
        setStatus('booting');
        setBootError(null);
        const id = fixedProjectId
          ? fixedProjectId
          : (await ensureChatWorkspace()).id;
        if (cancelled) return;
        setWorkspaceId(id);

        if (!fixedProjectId) {
          const storedRaw = localStorage.getItem(storageKey(id));
          if (storedRaw) {
            try {
              const stored = JSON.parse(storedRaw) as { sessionId: string };
              const detail = await getSession(stored.sessionId);
              if (!cancelled && detail.projectId === id) {
                setSessionId(detail.id);
                setMessages(storedToChat(detail.messages));
                setStatus('ready');
                void refreshRecent(id);
                return;
              }
            } catch {
              localStorage.removeItem(storageKey(id));
            }
          }

          try {
            const latest = await getLatestSession(id);
            if (!cancelled && latest.sessionId) {
              const detail = await getSession(latest.sessionId);
              if (!cancelled && detail.projectId === id) {
                localStorage.setItem(
                  storageKey(id),
                  JSON.stringify({ sessionId: detail.id }),
                );
                setSessionId(detail.id);
                setMessages(storedToChat(detail.messages));
                setStatus('ready');
                void refreshRecent(id);
                return;
              }
            }
          } catch {
            /* no sessions yet */
          }
        }

        // Project chat: create a session only if none will be opened via URL yet.
        // Personal chat: create when nothing to resume.
        if (!fixedProjectId) {
          const session = await createSession(id, 'chat');
          if (cancelled) return;
          localStorage.setItem(
            storageKey(id),
            JSON.stringify({ sessionId: session.id }),
          );
          setSessionId(session.id);
          setMessages([]);
          setStatus('ready');
          void refreshRecent(id);
          return;
        }

        // Project workspace ready — session bound by openSession(chatId) from the page.
        setSessionId(null);
        setMessages([]);
        setStatus('ready');
        void refreshRecent(id);
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
  }, [fixedProjectId, refreshRecent]);

  const sendPrompt = useCallback(
    async (message: string, attachments: ChatAttachment[] = []) => {
      if (!sessionId || !workspaceId || streaming) return;
      const ac = new AbortController();
      abortRef.current = ac;
      setStreaming(true);
      assistantBuf.current = '';
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'user',
          content: message,
          attachments: attachments.length
            ? attachments.map((a) => ({
                name: a.name,
                mime: a.mime,
                textPreview: a.textPreview,
                byteSize: a.size,
              }))
            : undefined,
        },
      ]);
      try {
        await handleEvents(
          streamPrompt(
            sessionId,
            {
              message: userMessageText(message),
              projectId: workspaceId,
              mode: fixedProjectId ? 'project_chat' : 'chat',
              webSearchEnabled: webSearch,
              attachments: attachments.map((a) => ({
                name: a.name,
                mime: a.mime,
                textPreview: a.textPreview,
                byteSize: a.size,
                contentText: a.contentText,
                contentBase64: a.contentBase64,
              })),
            },
            ac.signal,
          ),
          ac.signal,
        );
        if (!ac.signal.aborted) {
          void refreshRecent(workspaceId);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('wc:sessions-changed'));
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (ac.signal.aborted) return;
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'system',
            content: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ]);
      } finally {
        if (abortRef.current === ac) {
          abortRef.current = null;
          setStreaming(false);
        }
      }
    },
    [
      sessionId,
      workspaceId,
      streaming,
      webSearch,
      fixedProjectId,
      handleEvents,
      refreshRecent,
    ],
  );

  const newChat = useCallback(async () => {
    if (!workspaceId || streaming) return;
    const session = await createSession(workspaceId, 'chat');
    localStorage.setItem(
      storageKey(workspaceId),
      JSON.stringify({ sessionId: session.id }),
    );
    setSessionId(session.id);
    setMessages([]);
    void refreshRecent(workspaceId);
    return session.id;
  }, [workspaceId, streaming, refreshRecent]);

  const openSession = useCallback(
    async (id: string) => {
      if (!workspaceId || streaming) return false;
      try {
        const detail = await getSession(id);
        if (detail.projectId !== workspaceId) {
          setBootError('That chat belongs to a different project.');
          return false;
        }
        localStorage.setItem(
          storageKey(workspaceId),
          JSON.stringify({ sessionId: detail.id }),
        );
        setSessionId(detail.id);
        setMessages(storedToChat(detail.messages));
        setBootError(null);
        return true;
      } catch (err) {
        setBootError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [workspaceId, streaming],
  );

  const cancelGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    assistantBuf.current = '';
    setStreaming(false);
    setMessages((prev) => [
      ...prev.filter((m) => m.id !== 'stream-assistant'),
      { id: uid(), role: 'system', content: 'Generation stopped.' },
    ]);
  }, []);

  const hasUserMessages = messages.some((m) => m.role === 'user');

  return {
    status,
    bootError,
    workspaceId,
    sessionId,
    messages,
    streaming,
    webSearch,
    setWebSearch,
    recent,
    hasUserMessages,
    sendPrompt,
    newChat,
    openSession,
    cancelGeneration,
  };
}
