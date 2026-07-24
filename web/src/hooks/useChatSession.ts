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
  return messages.map((m) => ({
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

function buildPrompt(
  message: string,
  attachments: ChatAttachment[],
  webSearch: boolean,
): string {
  const parts = [message];
  if (attachments.length) {
    parts.push(
      '',
      'Attached context:',
      ...attachments.map(
        (a) => `--- ${a.name} (${a.mime}) ---\n${a.textPreview}`,
      ),
    );
  }
  if (webSearch) {
    parts.push(
      '',
      '[System: Web search is ON. Use web_search (and web_extract when needed). Cite sources with title + URL.]',
    );
  } else {
    parts.push(
      '',
      '[System: Web search is OFF for this message. Do not call web_search unless the user explicitly asks.]',
    );
  }
  return parts.join('\n');
}

/**
 * Chat session against a project workspace.
 * Omit projectId → personal Chat workspace (`__walkcroach_chat__`).
 * Pass projectId (+ optional initialSessionId) for project-scoped chats.
 */
export function useChatSession(opts?: {
  projectId?: string;
  initialSessionId?: string;
}) {
  const fixedProjectId = opts?.projectId;
  const initialSessionId = opts?.initialSessionId;
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    fixedProjectId ?? null,
  );
  const [sessionId, setSessionId] = useState<string | null>(
    initialSessionId ?? null,
  );
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
    async (events: AsyncIterable<AgentEvent>) => {
      for await (const event of events) {
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
        const id = fixedProjectId
          ? fixedProjectId
          : (await ensureChatWorkspace()).id;
        if (cancelled) return;
        setWorkspaceId(id);

        if (initialSessionId) {
          const detail = await getSession(initialSessionId);
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
  }, [fixedProjectId, initialSessionId, refreshRecent]);

  const sendPrompt = useCallback(
    async (message: string, attachments: ChatAttachment[] = []) => {
      if (!sessionId || !workspaceId || streaming) return;
      abortRef.current?.abort();
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
              message: buildPrompt(message, attachments, webSearch),
              projectId: workspaceId,
              mode: fixedProjectId ? 'project_chat' : 'chat',
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
        );
        void refreshRecent(workspaceId);
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
      if (!workspaceId || streaming) return;
      const detail = await getSession(id);
      localStorage.setItem(
        storageKey(workspaceId),
        JSON.stringify({ sessionId: detail.id }),
      );
      setSessionId(detail.id);
      setMessages(storedToChat(detail.messages));
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
