import { useMemo, useState, type FormEvent } from 'react';
import { getApiUrl } from './api/client';
import type { AgentMode, ChatMessage } from './api/types';
import { useAgentSession } from './hooks/useAgentSession';
import { useWebContainer } from './hooks/useWebContainer';

const PROJECT_NAME = 'WalkCroach App';

function MessageRow({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'user') {
    return (
      <div className="ml-8 rounded-sm border border-line bg-panel/80 px-3 py-2 text-sm text-paper">
        {msg.content}
      </div>
    );
  }
  if (msg.role === 'tool') {
    return (
      <div className="inline-flex items-center gap-2 rounded-sm border border-signal/30 bg-signal/10 px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-signal">
        {msg.content}
      </div>
    );
  }
  if (msg.role === 'system') {
    return (
      <p className="text-[12px] text-mist">{msg.content}</p>
    );
  }
  return (
    <div className="mr-4 whitespace-pre-wrap text-sm leading-relaxed text-paper/90">
      {msg.content}
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<AgentMode>('build');
  const [draft, setDraft] = useState('');
  const wc = useWebContainer(PROJECT_NAME);
  const actions = useMemo(
    () => ({
      applyWriteFile: wc.applyWriteFile,
      applyEditFile: wc.applyEditFile,
      applyTerminal: wc.applyTerminal,
    }),
    [wc.applyWriteFile, wc.applyEditFile, wc.applyTerminal],
  );
  const session = useAgentSession(
    PROJECT_NAME,
    mode,
    actions,
    wc.status === 'ready',
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || session.streaming) return;
    setDraft('');
    void session.sendPrompt(text);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-end justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <p className="font-display text-3xl font-extrabold tracking-tight text-paper md:text-4xl">
            WalkCroach
          </p>
          <p className="mt-1 max-w-xl text-sm text-mist">
            Memory-first builder — CockroachDB recalls what you already decided.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex overflow-hidden rounded-sm border border-line text-xs uppercase tracking-wider">
            <button
              type="button"
              className={`px-3 py-1.5 ${mode === 'plan' ? 'bg-signal text-ink' : 'text-mist hover:text-paper'}`}
              onClick={() => setMode('plan')}
            >
              Plan
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 ${mode === 'build' ? 'bg-signal text-ink' : 'text-mist hover:text-paper'}`}
              onClick={() => setMode('build')}
            >
              Build
            </button>
          </div>
          <button
            type="button"
            onClick={() => void session.newSession()}
            className="text-[11px] text-mist underline-offset-2 hover:text-paper hover:underline"
          >
            New session
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col border-b border-line lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[11px] uppercase tracking-wider text-mist">
            <span>Agent</span>
            <span className="normal-case tracking-normal">
              {session.status === 'ready'
                ? `session ${session.sessionId?.slice(0, 8)}…`
                : session.status}
              {' · '}
              api {getApiUrl().replace(/^https?:\/\//, '')}
            </span>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {session.bootError && (
              <p className="text-sm text-ember">
                API bootstrap failed: {session.bootError}. Start the local backend
                (`cd infra-backend && npm run dev`) or set <code>VITE_API_URL</code>.
              </p>
            )}
            {session.messages.map((m) => (
              <MessageRow key={m.id} msg={m} />
            ))}
            {session.streaming && (
              <p className="animate-pulse text-[11px] text-signal">streaming…</p>
            )}
          </div>

          <form
            onSubmit={onSubmit}
            className="border-t border-line p-3"
          >
            <label className="sr-only" htmlFor="prompt">
              Prompt
            </label>
            <textarea
              id="prompt"
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                mode === 'plan'
                  ? 'Plan the app — no file writes yet…'
                  : 'Build a muted landing page with a contact CTA…'
              }
              className="w-full resize-none rounded-sm border border-line bg-ink/60 px-3 py-2 text-sm text-paper outline-none placeholder:text-mist/60 focus:border-signal/50"
              disabled={session.status !== 'ready' || session.streaming}
            />
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[11px] text-mist">
                {mode === 'build'
                  ? 'Build mode: write_file / edit_file / terminal'
                  : 'Plan mode: memory tools only'}
              </p>
              <button
                type="submit"
                disabled={
                  session.status !== 'ready' ||
                  session.streaming ||
                  !draft.trim()
                }
                className="rounded-sm bg-signal px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </form>
        </section>

        <section className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[11px] uppercase tracking-wider text-mist">
            <span>Preview</span>
            <span className="normal-case tracking-normal">
              WebContainer · {wc.status}
              {wc.previewUrl ? ` · ${wc.previewUrl}` : ''}
            </span>
          </div>

          <div className="relative min-h-0 flex-1 bg-black/40">
            {wc.error && (
              <div className="absolute inset-0 z-10 grid place-items-center p-6 text-center text-sm text-ember">
                {wc.error}
              </div>
            )}
            {!wc.previewUrl && !wc.error && (
              <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-mist">
                Booting in-browser Node… first install can take a minute.
              </div>
            )}
            {wc.previewUrl && (
              <iframe
                title="WalkCroach preview"
                src={wc.previewUrl}
                className="h-full w-full border-0 bg-white"
                allow="cross-origin-isolated"
              />
            )}
          </div>

          <div className="max-h-36 overflow-y-auto border-t border-line bg-ink/80 px-3 py-2 font-mono text-[10px] leading-relaxed text-mist">
            {wc.logs.length === 0 ? (
              <span>terminal idle</span>
            ) : (
              wc.logs.slice(-40).map((line, i) => (
                <div key={`${i}-${line.slice(0, 12)}`} className="whitespace-pre-wrap">
                  {line}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
