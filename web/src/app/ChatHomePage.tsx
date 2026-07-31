import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { ChatComposer } from '../features/chat/ChatComposer';
import { CHAT_TEMPLATES } from '../features/chat/chatTemplates';
import { CreativeConfirmCard } from '../features/chat/CreativeConfirmCard';
import { ConnectorConfirmCard } from '../features/chat/ConnectorConfirmCard';
import { UpgradeModal } from '../features/billing/UpgradeModal';
import { ImageQuotaPill } from '../features/chat/ImageQuotaPill';
import { MessageRow, StreamingSkeleton } from '../features/chat/MessageRow';
import { useChatSession } from '../hooks/useChatSession';
import { useShell } from '../hooks/useShell';
import { fetchChromeChatHandoff } from '../api/client';
import {
  consumePendingChatContext,
  formatChatHandoffDraft,
} from '../lib/pending-chat-context';

/**
 * Chat home — welcome + templates when empty; thread when active.
 * Recents live in the expandable sidebar; a compact strip remains when collapsed.
 * Supports Chrome deep-link: /app/chat?handoff=<code>&q=<short>&webSearch=1
 */
export function ChatHomePage() {
  const { chatId } = useParams<{ chatId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { expanded } = useShell();
  const {
    status,
    bootError,
    messages,
    streaming,
    webSearch,
    setWebSearch,
    recent,
    hasUserMessages,
    sendPrompt,
    newChat,
    sessionId,
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
    dismissUpgrade,
  } = useChatSession();

  const [draft, setDraft] = useState<string | undefined>(undefined);
  const handoffConsumed = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const displayName =
    user?.displayName?.split(/\s+/)[0] ||
    user?.email?.split('@')[0] ||
    'there';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streaming]);

  // Chrome extension /connect handoff → composer draft
  useEffect(() => {
    if (status !== 'ready' || handoffConsumed.current) return;

    const handoff = searchParams.get('handoff')?.trim();
    const q = searchParams.get('q')?.trim();
    const webSearchParam = searchParams.get('webSearch');

    if (webSearchParam === '1') setWebSearch(true);
    if (webSearchParam === '0') setWebSearch(false);

    if (!handoff && !q) {
      const pending = consumePendingChatContext();
      if (pending) {
        handoffConsumed.current = true;
        setDraft(formatChatHandoffDraft(pending));
      }
      return;
    }

    let cancelled = false;
    void (async () => {
      let draftText = '';
      let handoffOk = false;

      if (handoff) {
        const cacheKey = `walkcroach.handoff.${handoff}`;
        try {
          const cached = sessionStorage.getItem(cacheKey);
          if (cached) {
            const ctx = JSON.parse(cached) as {
              title?: string | null;
              url?: string | null;
              extractedText: string;
              question?: string | null;
            };
            draftText = formatChatHandoffDraft(ctx);
            handoffOk = Boolean(draftText);
          } else {
            const ctx = await fetchChromeChatHandoff(handoff);
            if (cancelled) return;
            sessionStorage.setItem(cacheKey, JSON.stringify(ctx));
            draftText = formatChatHandoffDraft(ctx);
            handoffOk = Boolean(draftText);
          }
        } catch {
          if (cancelled) return;
          // Keep ?handoff= so the user can retry after signing in / refresh.
          if (q) draftText = q;
          else {
            setDraft(undefined);
            return;
          }
        }
      } else if (q) {
        draftText = q;
        handoffOk = true;
      }

      if (cancelled) return;
      if (draftText) setDraft(draftText);

      // Only strip URL params after a successful handoff (or q-only link).
      if (handoffOk || (!handoff && q)) {
        handoffConsumed.current = true;
        const next = new URLSearchParams(searchParams);
        next.delete('handoff');
        next.delete('q');
        next.delete('webSearch');
        setSearchParams(next, { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, searchParams, setSearchParams, setWebSearch]);

  useEffect(() => {
    const state = location.state as { newChat?: boolean } | null;
    if (!state?.newChat || status !== 'ready') return;
    void (async () => {
      const id = await newChat();
      navigate(id ? `/app/chat/${id}` : '/app/chat', {
        replace: true,
        state: {},
      });
    })();
  }, [location.state, status, newChat, navigate]);

  useEffect(() => {
    if (status !== 'ready' || !chatId || streaming) return;
    if (chatId === sessionId) return;
    void (async () => {
      const ok = await openSession(chatId);
      if (!ok && sessionId) {
        navigate(`/app/chat/${sessionId}`, { replace: true });
      }
    })();
  }, [chatId, sessionId, status, streaming, openSession, navigate]);

  useEffect(() => {
    const creatingNew = Boolean(
      (location.state as { newChat?: boolean } | null)?.newChat,
    );
    if (status !== 'ready' || !sessionId || chatId || creatingNew) return;
    navigate(`/app/chat/${sessionId}`, { replace: true });
  }, [status, sessionId, chatId, navigate, location.state]);

  const onDraftConsumed = useCallback(() => setDraft(undefined), []);

  if (status === 'booting') {
    return (
      <div className="grid h-full place-items-center text-sm text-mist">
        Starting chat…
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-sm text-ember">
        {bootError ?? 'Could not start chat'}
      </div>
    );
  }

  const showEmpty = !hasUserMessages;
  const showCollapsedRecents =
    !expanded && (recent.length > 0 || hasUserMessages);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showCollapsedRecents && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line/80 px-4 py-2.5">
          <button
            type="button"
            onClick={() => {
              void (async () => {
                const id = await newChat();
                if (id) navigate(`/app/chat/${id}`);
              })();
            }}
            className="btn-ghost shrink-0 text-xs"
            disabled={streaming}
          >
            New chat
          </button>
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
            {recent.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={streaming}
                onClick={() => {
                  if (streaming) return;
                  void (async () => {
                    const ok = await openSession(s.id);
                    if (ok) navigate(`/app/chat/${s.id}`);
                  })();
                }}
                className={`interactive shrink-0 rounded-[var(--radius-control)] border px-3 py-1.5 text-[12px] disabled:opacity-50 ${
                  s.id === sessionId
                    ? 'border-signal/45 bg-raised text-paper'
                    : 'border-line text-mist hover:border-signal/30 hover:text-paper'
                }`}
              >
                {s.title}
              </button>
            ))}
          </div>
          <ImageQuotaPill />
        </div>
      )}

      {showEmpty ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-3 pt-6 sm:px-10 sm:pt-10">
            <div className="wc-enter shrink-0">
              <p className="eyebrow">Chat</p>
              <h1 className="mt-2 font-display text-[1.85rem] font-extrabold tracking-tight text-paper sm:mt-3 sm:text-4xl">
                Welcome, {displayName}
              </h1>
              <p className="mt-1.5 max-w-md text-sm text-mist sm:mt-2">
                Ask anything — search the web, attach a file, or start from a
                template.
              </p>
            </div>

            <div className="wc-enter-delay mx-auto mt-5 grid w-full max-w-xl shrink-0 grid-cols-2 gap-2.5 sm:mt-8 sm:gap-4">
              {CHAT_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDraft(t.prompt)}
                  className="interactive flex min-h-[3.75rem] items-center justify-center rounded-[var(--radius-surface)] border border-line bg-panel/50 px-3 py-3 text-center text-[13px] font-semibold text-paper transition hover:border-signal/40 hover:bg-raised sm:min-h-[5.25rem] sm:px-4 sm:py-5 sm:text-sm"
                >
                  {t.title}
                </button>
              ))}
            </div>

            <div className="mt-auto w-full shrink-0 pt-5 sm:pt-10">
              <ChatComposer
                webSearch={webSearch}
                onWebSearchChange={setWebSearch}
                onSend={(msg, files) => void sendPrompt(msg, files)}
                onCancel={cancelGeneration}
                streaming={streaming}
                draft={draft}
                onDraftConsumed={onDraftConsumed}
              />
              <p className="mt-2 text-center text-[11px] leading-relaxed text-mist/80 sm:mt-3 sm:text-[12px]">
                WalkCroach AI can make mistakes. Make sure you cross check its
                responses.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-7 sm:px-8">
            <div className="mx-auto flex max-w-3xl flex-col gap-5">
              {messages.map((msg) => (
                <div key={msg.id}>
                  <MessageRow
                    msg={msg}
                    streaming={streaming && msg.id === 'stream-assistant'}
                    saveContext={{ sessionId }}
                  />
                  {msg.citations && msg.citations.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-2 pl-10">
                      {msg.citations.map((c) => (
                        <li key={c.url}>
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noreferrer"
                            className="interactive inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-panel/70 px-2.5 py-1 text-[11px] text-mist hover:border-signal/35 hover:text-paper"
                          >
                            <span className="max-w-[12rem] truncate">
                              {c.title}
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {streaming &&
                !messages.some((m) => m.id === 'stream-assistant') && (
                  <StreamingSkeleton />
                )}
              <div ref={bottomRef} />
            </div>
          </div>

          {pendingCreative && (
            <div className="shrink-0 border-t border-line/80 bg-ink/90 px-4 py-3 backdrop-blur-md sm:px-8">
              <div className="mx-auto max-w-3xl">
                <CreativeConfirmCard
                  pending={pendingCreative}
                  busy={creativeBusy}
                  onConfirm={() => void confirmCreative()}
                  onDecline={declineCreative}
                />
              </div>
            </div>
          )}

          {pendingConnector && (
            <div className="shrink-0 border-t border-line/80 bg-ink/90 px-4 py-3 backdrop-blur-md sm:px-8">
              <div className="mx-auto max-w-3xl">
                <ConnectorConfirmCard
                  pending={pendingConnector}
                  busy={connectorBusy}
                  onConfirm={() => void confirmConnector()}
                  onDecline={declineConnector}
                />
              </div>
            </div>
          )}

          <div className="shrink-0 border-t border-line/80 bg-ink/80 px-4 py-4 backdrop-blur-md sm:px-8">
            <div className="mx-auto max-w-3xl">
              <ChatComposer
                webSearch={webSearch}
                onWebSearchChange={setWebSearch}
                onSend={(msg, files) => void sendPrompt(msg, files)}
                onCancel={cancelGeneration}
                streaming={streaming}
                draft={draft}
                onDraftConsumed={onDraftConsumed}
              />
              <p className="mt-2.5 text-center text-[12px] text-mist/70">
                WalkCroach AI can make mistakes. Make sure you cross check its
                responses.{' '}
                <Link
                  to="/app/projects"
                  className="font-medium text-signal hover:underline"
                >
                  Open Projects
                </Link>
              </p>
            </div>
          </div>
        </>
      )}
      <UpgradeModal
        open={Boolean(upgradePrompt)}
        message={
          upgradePrompt?.message ??
          'Upgrade to Paid (~$20/mo) for creatives and connector writes.'
        }
        feature={upgradePrompt?.feature}
        onClose={dismissUpgrade}
      />
    </div>
  );
}
