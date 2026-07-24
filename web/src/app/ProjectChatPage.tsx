import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getProject } from '../api/client';
import { BuilderIconLink } from '../features/builder/BuilderIconLink';
import { ChatComposer } from '../features/chat/ChatComposer';
import { MessageRow, StreamingSkeleton } from '../features/chat/MessageRow';
import { useChatSession } from '../hooks/useChatSession';

/** Project-scoped chat — respects standing instructions + documents (PJ-11/12). */
export function ProjectChatPage() {
  const { projectId, chatId } = useParams<{
    projectId: string;
    chatId: string;
  }>();
  const navigate = useNavigate();
  const [projectName, setProjectName] = useState<string | null>(null);
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
    openSession,
    cancelGeneration,
    sessionId,
  } = useChatSession({
    projectId,
    initialSessionId: chatId,
  });

  const [draft, setDraft] = useState<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  const onDraftConsumed = useCallback(() => setDraft(undefined), []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await getProject(projectId);
        if (!cancelled) setProjectName(p.name);
      } catch {
        if (!cancelled) setProjectName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streaming]);

  useEffect(() => {
    if (projectId && sessionId && sessionId !== chatId) {
      navigate(`/app/projects/${projectId}/chat/${sessionId}`, {
        replace: true,
      });
    }
  }, [projectId, sessionId, chatId, navigate]);

  if (!projectId) {
    return null;
  }

  if (status === 'booting') {
    return (
      <div className="grid h-full place-items-center text-sm text-mist">
        Starting project chat…
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
        <Link
          to={`/app/projects/${projectId}`}
          className="interactive shrink-0 text-[11px] text-mist hover:text-signal"
        >
          ← {projectName ?? 'Project'}
        </Link>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              const id = await newChat();
              if (id) navigate(`/app/projects/${projectId}/chat/${id}`);
            })();
          }}
          className="btn-ghost shrink-0 text-xs"
          disabled={streaming}
        >
          New chat
        </button>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {recent.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                void openSession(s.id);
                navigate(`/app/projects/${projectId}/chat/${s.id}`);
              }}
              className={`interactive shrink-0 rounded-full border px-3 py-1 text-[11px] ${
                s.id === sessionId
                  ? 'border-signal/50 text-paper'
                  : 'border-line text-mist hover:border-signal/40 hover:text-paper'
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>
        <BuilderIconLink projectId={projectId} label="Builder" />
      </div>

      {!hasUserMessages ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pb-4 pt-10 sm:px-10">
            <h1 className="font-display text-2xl font-bold text-paper sm:text-3xl">
              Chat in {projectName ?? 'project'}
            </h1>
            <p className="mt-2 text-sm text-mist">
              Standing instructions and documents from the project home are
              included in context.
            </p>
            <div className="mt-auto w-full pt-16">
              <ChatComposer
                webSearch={webSearch}
                onWebSearchChange={setWebSearch}
                onSend={(msg, files) => void sendPrompt(msg, files)}
                onCancel={cancelGeneration}
                streaming={streaming}
                draft={draft}
                onDraftConsumed={onDraftConsumed}
              />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {messages.map((msg) => (
                <div key={msg.id}>
                  <MessageRow
                    msg={msg}
                    streaming={streaming && msg.id === 'stream-assistant'}
                    saveContext={{ projectId, sessionId }}
                  />
                  {msg.citations && msg.citations.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-2 pl-8">
                      {msg.citations.map((c) => (
                        <li key={c.url}>
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noreferrer"
                            className="interactive inline-flex items-center gap-1.5 rounded-full border border-line bg-panel/60 px-2.5 py-1 text-[10px] text-mist hover:border-signal/40 hover:text-paper"
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
          <div className="shrink-0 border-t border-line bg-ink/90 px-4 py-4 backdrop-blur-sm sm:px-8">
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
            </div>
          </div>
        </>
      )}
    </div>
  );
}
