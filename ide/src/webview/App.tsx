import { useEffect, useState, useCallback, useRef } from 'react';
import { getVsCodeApi } from './vscodeApi';
import { SettingsView } from './SettingsView';
import { MarkdownBody } from './MarkdownBody';
import { formatStopReason } from './formatStopReason';

type Phase = 'gather' | 'act' | 'verify' | null;
type Autonomy = 'strict' | 'low_friction';
type ChatMode = 'agent' | 'ask';

type ToolCard = {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  detail?: string;
};

type Subagent = {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
};

type Approval = {
  stepId: string;
  kind: 'diff' | 'command' | 'question';
  toolName: string;
  path?: string;
  before?: string;
  after?: string;
  cmd?: string;
  question?: string;
  options?: string[];
  allowFreeText?: boolean;
};

type AgentTodo = {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
};

type ChatTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  mode?: ChatMode;
  tools?: ToolCard[];
  subagents?: Subagent[];
  stopReason?: string;
  canContinue?: boolean;
};

type HostMessage =
  | { type: 'TOKEN_DELTA'; text: string }
  | { type: 'PHASE'; phase: Phase }
  | { type: 'DONE'; reason: string; canContinue?: boolean }
  | { type: 'ERROR'; message: string; fatal?: boolean }
  | { type: 'WARNING'; message: string }
  | {
      type: 'STATE_SNAPSHOT';
      trusted: boolean;
      streaming: boolean;
      transcript: string;
      autonomy: Autonomy;
      pendingApproval: Approval | null;
      mcpConfigured?: boolean;
      bedrockConfigured?: boolean;
      ccloudConfigured?: boolean;
      telemetry?: Record<string, number>;
      signedIn?: boolean;
      linkedProjectId?: string | null;
      linkedProjectName?: string | null;
      todos?: AgentTodo[];
      hasSession?: boolean;
    }
  | {
      type: 'TOOL_CARD';
      id: string;
      name: string;
      status: ToolCard['status'];
      detail?: string;
    }
  | {
      type: 'SUBAGENT';
      id: string;
      name: string;
      status: Subagent['status'];
      summary?: string;
    }
  | { type: 'TODOS'; todos: AgentTodo[] }
  | ({ type: 'APPROVAL_REQUEST' } & Approval)
  | {
      type: 'CACHE_USAGE';
      cacheReadInputTokens: number;
      cacheWriteInputTokens: number;
    }
  | {
      type: 'TELEMETRY';
      name: string;
      counters?: Record<string, number>;
      detail?: string;
    };

function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  // Prefer keeping path tails readable (Windows "New folder" looked truncated).
  if (n >= 48 && /[/\\]/.test(s)) {
    const head = Math.max(16, Math.floor(n * 0.35));
    const tail = n - head - 1;
    return `${s.slice(0, head)}…${s.slice(-tail)}`;
  }
  return `${s.slice(0, n)}…`;
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function App() {
  const [trusted, setTrusted] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [phase, setPhase] = useState<Phase>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<ChatMode>('agent');
  const [modeOpen, setModeOpen] = useState(false);
  const [autonomy, setAutonomy] = useState<Autonomy>('strict');
  const [approval, setApproval] = useState<Approval | null>(null);
  const [tools, setTools] = useState<ToolCard[]>([]);
  const [subagents, setSubagents] = useState<Subagent[]>([]);
  const [mcpConfigured, setMcpConfigured] = useState(false);
  const [bedrockConfigured, setBedrockConfigured] = useState(false);
  const [ccloudConfigured, setCcloudConfigured] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [linkedProjectId, setLinkedProjectId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [liveText, setLiveText] = useState('');
  const [todos, setTodos] = useState<AgentTodo[]>([]);
  const [hasSession, setHasSession] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [view, setView] = useState<'chat' | 'settings'>('chat');
  const threadRef = useRef<HTMLDivElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const liveTextRef = useRef('');
  const toolsRef = useRef<ToolCard[]>([]);
  const subagentsRef = useRef<Subagent[]>([]);

  useEffect(() => {
    liveTextRef.current = liveText;
  }, [liveText]);
  useEffect(() => {
    toolsRef.current = tools;
  }, [tools]);
  useEffect(() => {
    subagentsRef.current = subagents;
  }, [subagents]);

  const commitAssistantTurn = useCallback(
    (text: string, meta?: { stopReason?: string; canContinue?: boolean }) => {
      const toolsNow = toolsRef.current;
      const subsNow = subagentsRef.current;
      if (!text.trim() && toolsNow.length === 0 && subsNow.length === 0) {
        liveTextRef.current = '';
        setLiveText('');
        setTools([]);
        setSubagents([]);
        return;
      }
      setTurns((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'assistant',
          text,
          tools: toolsNow.length ? toolsNow : undefined,
          subagents: subsNow.length ? subsNow : undefined,
          stopReason: meta?.stopReason,
          canContinue: meta?.canContinue,
        },
      ]);
      liveTextRef.current = '';
      setLiveText('');
      setTools([]);
      setSubagents([]);
    },
    [],
  );

  useEffect(() => {
    const vscode = getVsCodeApi();
    vscode.postMessage({ type: 'READY' });

    const onMessage = (event: MessageEvent<HostMessage>) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object' || !('type' in msg)) return;

      switch (msg.type) {
        case 'STATE_SNAPSHOT':
          setTrusted(msg.trusted);
          setStreaming(msg.streaming);
          setAutonomy(msg.autonomy);
          setApproval(msg.pendingApproval);
          setMcpConfigured(Boolean(msg.mcpConfigured));
          setBedrockConfigured(Boolean(msg.bedrockConfigured));
          setCcloudConfigured(Boolean(msg.ccloudConfigured));
          setSignedIn(Boolean(msg.signedIn));
          setLinkedProjectId(msg.linkedProjectId ?? null);
          if (msg.todos) setTodos(msg.todos);
          setHasSession(Boolean(msg.hasSession));
          // Do NOT copy host transcript into liveText — that duplicates the
          // assistant turn already committed on DONE (chat owns history).
          break;
        case 'TOKEN_DELTA':
          setLiveText((t) => {
            const next = t + msg.text;
            liveTextRef.current = next;
            return next;
          });
          break;
        case 'TODOS':
          setTodos(msg.todos);
          break;
        case 'PHASE':
          setPhase(msg.phase);
          break;
        case 'TOOL_CARD':
          setTools((prev) => {
            const i = prev.findIndex((t) => t.id === msg.id);
            const next = {
              id: msg.id,
              name: msg.name,
              status: msg.status,
              detail: msg.detail,
            };
            if (i < 0) return [...prev, next];
            const copy = [...prev];
            copy[i] = next;
            return copy;
          });
          break;
        case 'SUBAGENT':
          setSubagents((prev) => {
            const i = prev.findIndex((t) => t.id === msg.id);
            const next = {
              id: msg.id,
              name: msg.name,
              status: msg.status,
              summary: msg.summary,
            };
            if (i < 0) return [...prev, next];
            const copy = [...prev];
            copy[i] = next;
            return copy;
          });
          break;
        case 'APPROVAL_REQUEST':
          setApproval({
            stepId: msg.stepId,
            kind: msg.kind,
            toolName: msg.toolName,
            path: msg.path,
            before: msg.before,
            after: msg.after,
            cmd: msg.cmd,
            question: msg.question,
            options: msg.options,
            allowFreeText: msg.allowFreeText,
          });
          break;
        case 'CACHE_USAGE':
        case 'TELEMETRY':
          break;
        case 'DONE':
          setStreaming(false);
          setPhase(null);
          setApproval(null);
          setError(null);
          commitAssistantTurn(liveTextRef.current, {
            stopReason: msg.reason,
            canContinue: Boolean(msg.canContinue),
          });
          break;
        case 'WARNING':
          setError(msg.message);
          break;
        case 'ERROR':
          if (msg.fatal !== false) {
            setStreaming(false);
            setPhase(null);
            setApproval(null);
            const body = liveTextRef.current.trim()
              ? `${liveTextRef.current.trim()}\n\n${msg.message}`
              : msg.message;
            commitAssistantTurn(body, {
              stopReason: 'error',
              canContinue: false,
            });
          }
          setError(msg.message);
          break;
        default:
          break;
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [commitAssistantTurn]);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, liveText, tools, approval, streaming]);

  useEffect(() => {
    if (!modeOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!modeMenuRef.current?.contains(e.target as Node)) {
        setModeOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [modeOpen]);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || streaming || !trusted) return;
    setError(null);
    setLiveText('');
    liveTextRef.current = '';
    setTools([]);
    setSubagents([]);
    setApproval(null);
    setStreaming(true);
    setTurns((prev) => [
      ...prev,
      { id: uid(), role: 'user', text, mode },
    ]);
    setDraft('');
    getVsCodeApi().postMessage({
      type: 'SUBMIT_TASK',
      text,
      mode: mode === 'ask' ? 'plan' : 'act',
    });
  }, [draft, mode, streaming, trusted]);

  const cancel = useCallback(() => {
    getVsCodeApi().postMessage({ type: 'CANCEL' });
  }, []);

  const approve = useCallback(() => {
    if (!approval) return;
    getVsCodeApi().postMessage({
      type: 'APPROVE_STEP',
      stepId: approval.stepId,
    });
    setApproval(null);
  }, [approval]);

  const reject = useCallback(() => {
    if (!approval) return;
    getVsCodeApi().postMessage({
      type: 'REJECT_STEP',
      stepId: approval.stepId,
    });
    setApproval(null);
    setFreeText('');
  }, [approval]);

  const answerQuestion = useCallback(
    (selected: string) => {
      if (!approval || approval.kind !== 'question') return;
      getVsCodeApi().postMessage({
        type: 'ANSWER_QUESTION',
        stepId: approval.stepId,
        selected,
        freeText: freeText.trim() || undefined,
      });
      setApproval(null);
      setFreeText('');
    },
    [approval, freeText],
  );

  const clearSession = useCallback(() => {
    if (streaming) return;
    setTurns([]);
    setTodos([]);
    setLiveText('');
    liveTextRef.current = '';
    setTools([]);
    setSubagents([]);
    setApproval(null);
    setError(null);
    setHasSession(false);
    getVsCodeApi().postMessage({ type: 'CLEAR_SESSION' });
  }, [streaming]);

  const toggleAutonomy = useCallback(() => {
    const next: Autonomy =
      autonomy === 'strict' ? 'low_friction' : 'strict';
    setAutonomy(next);
    getVsCodeApi().postMessage({ type: 'SET_AUTONOMY', level: next });
  }, [autonomy]);

  const signIn = useCallback(() => {
    getVsCodeApi().postMessage({ type: 'SIGN_IN' });
  }, []);

  const continueRun = useCallback(() => {
    if (streaming || !trusted) return;
    setError(null);
    setLiveText('');
    liveTextRef.current = '';
    setTools([]);
    setSubagents([]);
    setApproval(null);
    setStreaming(true);
    setTurns((prev) => [
      ...prev.map((t) =>
        t.canContinue ? { ...t, canContinue: false } : t,
      ),
      { id: uid(), role: 'user', text: 'Continue', mode },
    ]);
    getVsCodeApi().postMessage({ type: 'CONTINUE_TASK' });
  }, [streaming, trusted, mode]);

  const empty = turns.length === 0 && !streaming && !liveText;
  const needsSetup = !bedrockConfigured || !mcpConfigured;
  const lastTurn = turns[turns.length - 1];
  const showContinue =
    !streaming && Boolean(lastTurn?.canContinue) && trusted;

  if (view === 'settings') {
    return (
      <SettingsView
        bedrockConfigured={bedrockConfigured}
        mcpConfigured={mcpConfigured}
        ccloudConfigured={ccloudConfigured}
        onBack={() => setView('chat')}
      />
    );
  }

  return (
    <div className="chat">
      <header className="chat-top">
        <span className="brand">WalkCroach</span>
        <div className="chat-top-meta">
          {bedrockConfigured ? (
            <span className="pill on">Bedrock</span>
          ) : null}
          {mcpConfigured ? (
            <span className="pill on">Cockroach</span>
          ) : null}
          {signedIn ? (
            <span className="pill">{linkedProjectId ? 'Linked' : 'Signed in'}</span>
          ) : (
            <button type="button" className="linkish" onClick={signIn}>
              Sign in
            </button>
          )}
          {(hasSession || turns.length > 0) && !streaming ? (
            <button
              type="button"
              className="linkish"
              onClick={clearSession}
              title="Clear conversation session"
            >
              New chat
            </button>
          ) : null}
          <button
            type="button"
            className="gear"
            aria-label="Open setup"
            title="Setup"
            onClick={() => setView('settings')}
          >
            ⚙
          </button>
        </div>
      </header>

      {todos.length > 0 ? (
        <ul className="todo-list" aria-label="Agent checklist">
          {todos.map((t) => (
            <li key={t.id} data-status={t.status}>
              <span className="todo-status">{t.status}</span>
              <span className="todo-content">{t.content}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {needsSetup && (
        <button
          type="button"
          className="setup-cta"
          onClick={() => setView('settings')}
        >
          <span className="setup-cta-title">
            {!bedrockConfigured
              ? 'Add Bedrock & Cockroach credentials'
              : 'Add CockroachDB MCP (optional)'}
          </span>
          <span className="setup-cta-meta">Open setup →</span>
        </button>
      )}

      {!trusted && (
        <div className="banner" role="status">
          Trust this folder to run the agent.
        </div>
      )}

      {error && !streaming && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <div className="thread" ref={threadRef} aria-label="Conversation">
        {empty ? (
          <div className="empty">
            <p className="empty-brand">WalkCroach</p>
            <p className="empty-copy">
              Chat with an agent in this workspace. Agent can edit; Ask only
              explores.
            </p>
            {needsSetup ? (
              <button
                type="button"
                className="btn primary"
                onClick={() => setView('settings')}
              >
                Configure credentials
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {turns.map((t) => (
              <article
                key={t.id}
                className={`bubble ${t.role}`}
                data-mode={t.mode}
              >
                <div className="bubble-label">
                  {t.role === 'user'
                    ? t.mode === 'ask'
                      ? 'You · Ask'
                      : 'You · Agent'
                    : 'WalkCroach'}
                </div>
                {t.role === 'assistant' &&
                (t.tools?.length || t.subagents?.length) ? (
                  <ul className="activity" aria-label="Activity">
                    {(t.tools ?? []).map((tool) => (
                      <li key={tool.id} data-status={tool.status}>
                        <span className="activity-name">{tool.name}</span>
                        <span className="activity-meta">
                          {tool.status}
                          {tool.detail ? ` · ${clip(tool.detail, 140)}` : ''}
                        </span>
                      </li>
                    ))}
                    {(t.subagents ?? []).map((s) => (
                      <li key={s.id} data-status={s.status}>
                        <span className="activity-name">{s.name}</span>
                        <span className="activity-meta">
                          subagent · {s.status}
                          {s.summary ? ` · ${clip(s.summary, 80)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {t.role === 'assistant' ? (
                  <MarkdownBody text={t.text} />
                ) : (
                  <div className="bubble-body user-text">{t.text}</div>
                )}
                {t.role === 'assistant' && t.stopReason ? (
                  <div
                    className={`stop-footer${t.canContinue ? ' actionable' : ''}`}
                  >
                    <span>{formatStopReason(t.stopReason)}</span>
                    {t.canContinue && t.id === lastTurn?.id && !streaming ? (
                      <button
                        type="button"
                        className="linkish"
                        onClick={continueRun}
                      >
                        Continue
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}

            {(streaming || liveText) && (
              <article className="bubble assistant live">
                <div className="bubble-label">
                  WalkCroach
                  {phase
                    ? ` · ${
                        phase === 'gather'
                          ? 'gathering'
                          : phase === 'act'
                            ? 'working'
                            : 'verifying'
                      }`
                    : ''}
                </div>
                {(tools.length > 0 || subagents.length > 0) && (
                  <ul className="activity" aria-label="Activity">
                    {tools.map((t) => (
                      <li key={t.id} data-status={t.status}>
                        <span className="activity-name">{t.name}</span>
                        <span className="activity-meta">
                          {t.status}
                          {t.detail ? ` · ${clip(t.detail, 140)}` : ''}
                        </span>
                      </li>
                    ))}
                    {subagents.map((s) => (
                      <li key={s.id} data-status={s.status}>
                        <span className="activity-name">{s.name}</span>
                        <span className="activity-meta">
                          subagent · {s.status}
                          {s.summary ? ` · ${clip(s.summary, 80)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {approval && (
                  <section
                    className="approval"
                    role="dialog"
                    aria-label={
                      approval.kind === 'question'
                        ? 'Question'
                        : 'Approval required'
                    }
                  >
                    <div className="approval-head">
                      {approval.kind === 'question'
                        ? 'Question'
                        : `Approval · ${approval.toolName}`}
                    </div>
                    {approval.kind === 'question' ? (
                      <>
                        <p className="question-text">{approval.question}</p>
                        <div className="question-options">
                          {(approval.options ?? []).map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              className="btn primary"
                              onClick={() => answerQuestion(opt)}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                        {approval.allowFreeText ? (
                          <textarea
                            className="question-freetext"
                            rows={2}
                            placeholder="Optional details…"
                            value={freeText}
                            onChange={(e) => setFreeText(e.target.value)}
                          />
                        ) : null}
                        <div className="row">
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={reject}
                          >
                            Skip
                          </button>
                        </div>
                      </>
                    ) : approval.kind === 'command' ? (
                      <pre className="diff">{approval.cmd}</pre>
                    ) : (
                      <>
                        <p className="path">{approval.path}</p>
                        <div className="diff-grid">
                          <pre className="diff before">
                            {clip(approval.before ?? '', 4000)}
                          </pre>
                          <pre className="diff after">
                            {clip(approval.after ?? '', 4000)}
                          </pre>
                        </div>
                      </>
                    )}
                    {approval.kind !== 'question' ? (
                      <div className="row">
                        <button
                          type="button"
                          className="btn primary"
                          onClick={approve}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn ghost"
                          onClick={reject}
                        >
                          Reject
                        </button>
                      </div>
                    ) : null}
                  </section>
                )}
                {liveText ? (
                  <MarkdownBody text={liveText} />
                ) : streaming ? (
                  <div className="bubble-body md thinking">…</div>
                ) : null}
              </article>
            )}
          </>
        )}
      </div>

      <footer className="composer">
        <textarea
          className="composer-input"
          rows={3}
          value={draft}
          disabled={!trusted}
          placeholder={
            mode === 'ask'
              ? 'Ask about this codebase…'
              : 'Describe a change for the agent…'
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-bar">
          <div className="mode-wrap" ref={modeMenuRef}>
            <button
              type="button"
              className="mode-btn"
              aria-haspopup="listbox"
              aria-expanded={modeOpen}
              onClick={() => setModeOpen((o) => !o)}
            >
              {mode === 'agent' ? 'Agent' : 'Ask'}
              <span className="caret" aria-hidden>
                ▾
              </span>
            </button>
            {modeOpen && (
              <ul className="mode-menu" role="listbox">
                <li role="option" aria-selected={mode === 'agent'}>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('agent');
                      setModeOpen(false);
                    }}
                  >
                    <span className="mode-title">Agent</span>
                    <span className="mode-desc">Edit files and run tools</span>
                  </button>
                </li>
                <li role="option" aria-selected={mode === 'ask'}>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('ask');
                      setModeOpen(false);
                    }}
                  >
                    <span className="mode-title">Ask</span>
                    <span className="mode-desc">Read-only answers</span>
                  </button>
                </li>
              </ul>
            )}
          </div>

          {mode === 'agent' ? (
            <button
              type="button"
              className="linkish autonomy"
              onClick={toggleAutonomy}
              title="Strict asks before edits. Guided auto-approves narrow file edits."
            >
              {autonomy === 'strict' ? 'Strict' : 'Guided'}
            </button>
          ) : null}

          <div className="composer-actions">
            {streaming ? (
              <button type="button" className="btn danger" onClick={cancel}>
                Stop
              </button>
            ) : (
              <>
                {showContinue ? (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={continueRun}
                  >
                    Continue
                  </button>
                ) : null}
                <button
                  type="button"
                  className="send"
                  onClick={submit}
                  disabled={!trusted || !draft.trim()}
                  aria-label="Send"
                >
                  ↑
                </button>
              </>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
