import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { ChatComposer } from '../features/chat/ChatComposer';
import { CHAT_TEMPLATES } from '../features/chat/chatTemplates';
import { MessageRow, StreamingSkeleton } from '../features/chat/MessageRow';
import { useChatSession } from '../hooks/useChatSession';
import { useShell } from '../hooks/useShell';

/**
 * Chat home — welcome + templates when empty; thread when active.
 * Recents live in the expandable sidebar; a compact strip remains when collapsed.
 */
export function ChatHomePage() {
  const { chatId } = useParams<{ chatId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
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
  } = useChatSession();

  const [draft, setDraft] = useState<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  const displayName =
    user?.displayName?.split(/\s+/)[0] ||
    user?.email?.split('@')[0] ||
    'there';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streaming]);

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
    void openSession(chatId);
  }, [chatId, sessionId, status, streaming, openSession]);

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
                onClick={() => {
                  void openSession(s.id);
                  navigate(`/app/chat/${s.id}`);
                }}
                className={`interactive shrink-0 rounded-[var(--radius-control)] border px-3 py-1.5 text-[12px] ${
                  s.id === sessionId
                    ? 'border-signal/45 bg-raised text-paper'
                    : 'border-line text-mist hover:border-signal/30 hover:text-paper'
                }`}
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {showEmpty ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pb-5 pt-12 sm:px-10">
            <div className="wc-enter">
              <p className="eyebrow">Chat</p>
              <h1 className="mt-3 font-display text-[2.35rem] font-extrabold tracking-tight text-paper sm:text-4xl">
                Welcome, {displayName}
              </h1>
              <p className="mt-2 max-w-md text-sm text-mist">
                Ask anything — search the web, attach context, or start from a
                template.
              </p>
            </div>

            <div className="wc-enter-delay mx-auto mt-10 grid w-full max-w-xl grid-cols-2 gap-3 sm:gap-4">
              {CHAT_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDraft(t.prompt)}
                  className="interactive flex min-h-[5.25rem] items-center justify-center rounded-[var(--radius-surface)] border border-line bg-panel/50 px-4 py-5 text-center text-sm font-semibold text-paper transition hover:border-signal/40 hover:bg-raised"
                >
                  {t.title}
                </button>
              ))}
            </div>

            <div className="mt-auto w-full pt-14">
              <ChatComposer
                webSearch={webSearch}
                onWebSearchChange={setWebSearch}
                onSend={(msg, files) => void sendPrompt(msg, files)}
                onCancel={cancelGeneration}
                streaming={streaming}
                draft={draft}
                onDraftConsumed={onDraftConsumed}
              />
              <p className="mt-3 text-center text-[12px] leading-relaxed text-mist/80">
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
    </div>
  );
}
