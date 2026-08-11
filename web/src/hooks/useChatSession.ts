import { useCallback, useEffect, useRef, useState, startTransition } from 'react';
import {
  createSession,
  ensureChatWorkspace,
  getLatestSession,
  getSession,
  listChatSessions,
  confirmCreativeRender,
  confirmVideoJob,
  executeConnectorRun,
  declineConnectorRun,
  streamPrompt,
} from '../api/client';
import type { AgentEvent, ChatMessage } from '../api/types';
import type { ChatAttachment } from '../features/chat/ChatComposer';

export type PendingCreativeBrief = {
  assetId: string;
  kind: 'slide_deck' | 'flyer' | 'video';
  brief: {
    title?: string;
    subtitle?: string;
    headline?: string;
    support?: string;
    cta?: string;
    brand?: string;
    eyebrow?: string;
    template?: string;
    philosophy?: { name?: string; notes?: string };
    voiceoverScript?: string;
    durationSec?: number;
    aspect?: string;
    shots?: Array<{ text?: string; title?: string }>;
    slides?: Array<{ title?: string; bullets?: string[] }>;
  };
  credits: number;
  estimatedImages: number;
  remainingImages: number;
  imageDailyLimit: number;
  remainingVideo?: number;
  videoLimit?: number;
  videoResetAt?: string;
  stub?: boolean;
};

export type PendingConnectorAction = {
  runId: string;
  action: string;
  title: string;
  consequence: string;
  write: boolean;
  irreversible: boolean;
  weight: number;
  rows: Array<{ label: string; value: string }>;
  needsConnection?: string;
  connectUrl?: string;
};

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
  const [pendingCreative, setPendingCreative] =
    useState<PendingCreativeBrief | null>(null);
  const [creativeBusy, setCreativeBusy] = useState(false);
  const [pendingConnector, setPendingConnector] =
    useState<PendingConnectorAction | null>(null);
  const [connectorBusy, setConnectorBusy] = useState(false);
  const [upgradePrompt, setUpgradePrompt] = useState<{
    message: string;
    feature?: string;
  } | null>(null);
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
          // Interruptible updates keep the composer responsive under fast streams.
          startTransition(() => {
            setMessages((prev) => {
              const withoutStream = prev.filter(
                (m) => m.id !== 'stream-assistant',
              );
              return [
                ...withoutStream,
                {
                  id: 'stream-assistant',
                  role: 'assistant' as const,
                  content: text,
                },
              ];
            });
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
        } else if (event.type === 'upgrade_required') {
          setUpgradePrompt({
            message: event.message,
            feature: event.feature,
          });
          setMessages((prev) => [
            ...prev,
            {
              id: uid(),
              role: 'system',
              content: event.message,
            },
          ]);
        } else if (event.type === 'connector_action_proposed') {
          setPendingConnector({
            runId: event.runId,
            action: event.action,
            title: event.title,
            consequence: event.consequence,
            write: event.write,
            irreversible: event.irreversible,
            weight: event.weight,
            rows: event.rows ?? [],
            needsConnection: event.needsConnection,
            connectUrl: event.connectUrl,
          });
        } else if (event.type === 'creative_brief_ready') {
          setPendingCreative({
            assetId: event.assetId,
            kind: event.kind,
            brief: event.brief as PendingCreativeBrief['brief'],
            credits: event.credits,
            estimatedImages: event.estimatedImages,
            remainingImages: event.remainingImages,
            imageDailyLimit: event.imageDailyLimit,
            stub: event.stub,
          });
        } else if (event.type === 'video_brief_ready') {
          setPendingCreative({
            assetId: event.jobId,
            kind: 'video',
            brief: event.brief as PendingCreativeBrief['brief'],
            credits: event.credits,
            estimatedImages: event.estimatedImages,
            remainingImages: event.remainingImages,
            imageDailyLimit: event.imageDailyLimit,
            remainingVideo: event.remainingVideo,
            videoLimit: event.videoLimit,
            videoResetAt: event.videoResetAt,
            stub: event.stub,
          });
        } else if (event.type === 'video_job_updated') {
          setPendingCreative(null);
          setMessages((prev) => [
            ...prev,
            {
              id: uid(),
              role: 'assistant',
              content: `Video job ${event.status}.`,
              videoJob: {
                jobId: event.jobId,
                status: event.status,
                durationSec: event.durationSec,
                aspect: event.aspect,
                creditsCharged: event.creditsCharged,
              },
            },
          ]);
        } else if (event.type === 'creative_asset_ready') {
          setPendingCreative(null);
          if (event.kind === 'flyer') {
            setMessages((prev) => [
              ...prev,
              {
                id: uid(),
                role: 'assistant',
                content: 'Your flyer is ready.',
                flyer: {
                  assetId: event.assetId,
                  downloadName: event.downloadName,
                  creditsCharged: event.creditsCharged,
                  previewUrl: event.previewDataUrl ?? null,
                  downloadUrl: null,
                },
              },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: uid(),
                role: 'assistant',
                content: `Your deck is ready (${event.slideCount ?? 0} slides).`,
                deck: {
                  assetId: event.assetId,
                  downloadName: event.downloadName,
                  slideCount: event.slideCount ?? 0,
                  creditsCharged: event.creditsCharged,
                  previewUrl: event.previewDataUrl ?? null,
                  downloadUrl: null,
                },
              },
            ]);
          }
        } else if (event.type === 'image_generated') {
          setMessages((prev) => [
            ...prev,
            {
              id: uid(),
              role: 'assistant',
              content: `Here is the image (remaining today: ${event.remainingToday}/${event.dailyLimit}).`,
              image: {
                assetId: event.assetId,
                prompt: event.prompt,
                dataUrl: event.dataUrl,
                storageKey: event.storageKey,
                width: event.width,
                height: event.height,
                remainingToday: event.remainingToday,
                dailyLimit: event.dailyLimit,
              },
            },
          ]);
        } else if (event.type === 'warning') {
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: 'system', content: event.message },
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
              const sessionMode = detail.mode ?? 'builder';
              if (
                !cancelled &&
                detail.projectId === id &&
                sessionMode === 'chat'
              ) {
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
            const latest = await getLatestSession(id, 'chat');
            if (!cancelled && latest.sessionId) {
              const detail = await getSession(latest.sessionId);
              const sessionMode = detail.mode ?? 'builder';
              if (
                !cancelled &&
                detail.projectId === id &&
                sessionMode === 'chat'
              ) {
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

  const confirmCreative = useCallback(async () => {
    if (!pendingCreative || creativeBusy) return;
    setCreativeBusy(true);
    try {
      if (pendingCreative.kind === 'video') {
        const result = await confirmVideoJob(pendingCreative.assetId);
        if (!result.ok && result.error) {
          const msg =
            result.error === 'video_quota_exceeded'
              ? `Video unavailable until ${result.resetAt ?? 'the 72h window resets'}.`
              : `Could not start video: ${result.error}`;
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: 'system', content: msg },
          ]);
          return;
        }
        setPendingCreative(null);
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'assistant',
            content: 'Video job started — this can take a few minutes.',
            videoJob: {
              jobId: result.jobId,
              status: result.status,
              durationSec: pendingCreative.brief.durationSec ?? 30,
              aspect: pendingCreative.brief.aspect ?? '16:9',
              creditsCharged: result.creditsCharged ?? pendingCreative.credits,
            },
          },
        ]);
        return;
      }

      const result = await confirmCreativeRender(pendingCreative.assetId);
      if (!result.ok && result.error) {
        if (result.error === 'paid_plan_required') {
          setUpgradePrompt({
            message:
              'Creatives require the Paid plan (~$20/mo). Upgrade to render slides and flyers.',
            feature: pendingCreative.kind,
          });
        } else if (result.error === 'insufficient_credits') {
          setUpgradePrompt({
            message:
              'Not enough credits for this creative. Upgrade or wait for the monthly grant reset.',
            feature: pendingCreative.kind,
          });
        }
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'system',
            content: `Could not render: ${result.error}`,
          },
        ]);
        return;
      }
      setPendingCreative(null);
      if (pendingCreative.kind === 'flyer') {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'assistant',
            content: 'Your flyer is ready.',
            flyer: {
              assetId: result.assetId,
              downloadName: result.downloadName ?? 'flyer.pdf',
              creditsCharged: pendingCreative.credits,
              previewUrl:
                result.previewUrl ??
                (result as { previewDataUrl?: string | null }).previewDataUrl ??
                null,
              downloadUrl: result.downloadUrl ?? null,
            },
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'assistant',
            content: `Your deck is ready${result.slideCount ? ` (${result.slideCount} slides)` : ''}.`,
            deck: {
              assetId: result.assetId,
              downloadName: result.downloadName ?? 'deck.pptx',
              slideCount: result.slideCount ?? 0,
              creditsCharged: pendingCreative.credits,
              previewUrl: result.previewUrl ?? null,
              downloadUrl: result.downloadUrl ?? null,
            },
          },
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/paid_plan|insufficient_credits/i.test(msg)) {
        setUpgradePrompt({
          message: msg,
          feature: pendingCreative?.kind,
        });
      }
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'system',
          content: msg,
        },
      ]);
    } finally {
      setCreativeBusy(false);
    }
  }, [pendingCreative, creativeBusy]);

  const declineCreative = useCallback(() => {
    setPendingCreative(null);
    setMessages((prev) => [
      ...prev,
      {
        id: uid(),
        role: 'system',
        content:
          pendingCreative?.kind === 'video'
            ? 'Video cancelled — no credits charged.'
            : pendingCreative?.kind === 'flyer'
              ? 'Flyer cancelled — no credits charged.'
              : 'Deck cancelled — no credits charged.',
      },
    ]);
  }, [pendingCreative?.kind]);

  const confirmConnector = useCallback(async () => {
    if (!pendingConnector?.runId || connectorBusy) return;
    setConnectorBusy(true);
    try {
      const result = await executeConnectorRun(pendingConnector.runId);
      setPendingConnector(null);
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'assistant',
          content: `Done: ${pendingConnector.title}. ${
            result.creditsCharged
              ? `(${result.creditsCharged} credits)`
              : ''
          }\n\`\`\`json\n${JSON.stringify(result.result, null, 2).slice(0, 2000)}\n\`\`\``,
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/paid_plan|402|insufficient_credits/i.test(msg)) {
        setUpgradePrompt({
          message: msg,
          feature: pendingConnector?.action,
        });
      }
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'system',
          content: msg,
        },
      ]);
    } finally {
      setConnectorBusy(false);
    }
  }, [pendingConnector, connectorBusy]);

  const declineConnector = useCallback(() => {
    const runId = pendingConnector?.runId;
    setPendingConnector(null);
    if (runId) {
      void declineConnectorRun(runId).catch(() => undefined);
    }
    setMessages((prev) => [
      ...prev,
      {
        id: uid(),
        role: 'system',
        content: 'Connector action declined — nothing was sent.',
      },
    ]);
  }, [pendingConnector?.runId]);

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
    pendingCreative,
    creativeBusy,
    confirmCreative,
    declineCreative,
    pendingConnector,
    connectorBusy,
    confirmConnector,
    declineConnector,
    upgradePrompt,
    dismissUpgrade: () => setUpgradePrompt(null),
  };
}
