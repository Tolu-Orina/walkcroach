import { useEffect, useState, useCallback } from 'react';
import { getVsCodeApi } from './vscodeApi';

type Phase = 'gather' | 'act' | 'verify' | null;
type Autonomy = 'strict' | 'low_friction';

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
  kind: 'diff' | 'command';
  toolName: string;
  path?: string;
  before?: string;
  after?: string;
  cmd?: string;
};

type HostMessage =
  | { type: 'TOKEN_DELTA'; text: string }
  | { type: 'PHASE'; phase: Phase }
  | { type: 'DONE'; reason: string }
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
      telemetry?: Record<string, number>;
      signedIn?: boolean;
      linkedProjectId?: string | null;
      linkedProjectName?: string | null;
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
  return `${s.slice(0, n)}\n…`;
}

function formatTelemetry(t: Record<string, number>): string {
  const parts = Object.entries(t)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}=${v}`);
  return parts.length ? parts.join(' · ') : '';
}

export function App() {
  const [trusted, setTrusted] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [phase, setPhase] = useState<Phase>(null);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState('');
  const [autonomy, setAutonomy] = useState<Autonomy>('strict');
  const [approval, setApproval] = useState<Approval | null>(null);
  const [tools, setTools] = useState<ToolCard[]>([]);
  const [subagents, setSubagents] = useState<Subagent[]>([]);
  const [cacheHint, setCacheHint] = useState<string | null>(null);
  const [mcpConfigured, setMcpConfigured] = useState(false);
  const [telemetry, setTelemetry] = useState<Record<string, number>>({});
  const [signedIn, setSignedIn] = useState(false);
  const [linkedProjectId, setLinkedProjectId] = useState<string | null>(null);
  const [linkedProjectName, setLinkedProjectName] = useState<string | null>(
    null,
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
          setTranscript(msg.transcript);
          setAutonomy(msg.autonomy);
          setApproval(msg.pendingApproval);
          setMcpConfigured(Boolean(msg.mcpConfigured));
          if (msg.telemetry) setTelemetry(msg.telemetry);
          setSignedIn(Boolean(msg.signedIn));
          setLinkedProjectId(msg.linkedProjectId ?? null);
          setLinkedProjectName(msg.linkedProjectName ?? null);
          setError(null);
          break;
        case 'TOKEN_DELTA':
          setTranscript((t) => t + msg.text);
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
          });
          break;
        case 'CACHE_USAGE':
          setCacheHint(
            `cache read=${msg.cacheReadInputTokens} write=${msg.cacheWriteInputTokens}`,
          );
          break;
        case 'TELEMETRY':
          if (msg.counters) setTelemetry(msg.counters);
          break;
        case 'DONE':
          setStreaming(false);
          setPhase(null);
          setApproval(null);
          break;
        case 'WARNING':
          setError(msg.message);
          break;
        case 'ERROR':
          if (msg.fatal !== false) {
            setStreaming(false);
            setPhase(null);
            setApproval(null);
          }
          setError(msg.message);
          break;
        default:
          break;
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const submit = useCallback(() => {
    const text = task.trim();
    if (!text) return;
    setError(null);
    setTranscript('');
    setTools([]);
    setSubagents([]);
    setApproval(null);
    setCacheHint(null);
    setTelemetry({});
    setStreaming(true);
    getVsCodeApi().postMessage({ type: 'SUBMIT_TASK', text });
  }, [task]);

  const ping = useCallback(() => {
    setTask('ping');
    setError(null);
    setTools([]);
    setSubagents([]);
    setStreaming(true);
    getVsCodeApi().postMessage({ type: 'SUBMIT_TASK', text: 'ping' });
  }, []);

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
  }, [approval]);

  const toggleAutonomy = useCallback(() => {
    const next: Autonomy =
      autonomy === 'strict' ? 'low_friction' : 'strict';
    setAutonomy(next);
    getVsCodeApi().postMessage({ type: 'SET_AUTONOMY', level: next });
  }, [autonomy]);

  const telemetryLine = formatTelemetry(telemetry);

  return (
    <div className="app">
      <h1 className="brand">WalkCroach</h1>
      <p className="meta">
        Phase C — local agent + optional Cognito link for cross-surface memory.
        Unlinked mode still works offline. Approvals default on.
      </p>

      <div className="status-row" aria-live="polite">
        <span className={signedIn ? 'chip ok' : 'chip warn'}>
          Auth: {signedIn ? 'signed in' : 'signed out'}
        </span>
        <span className={linkedProjectId ? 'chip ok' : 'chip muted'}>
          Link:{' '}
          {linkedProjectId
            ? linkedProjectName || linkedProjectId
            : 'not linked'}
        </span>
        <span className={mcpConfigured ? 'chip ok' : 'chip warn'}>
          MCP: {mcpConfigured ? 'configured' : 'not configured'}
        </span>
        {telemetryLine ? (
          <span className="chip muted">{telemetryLine}</span>
        ) : null}
      </div>

      {!trusted && (
        <div className="banner" role="status">
          Workspace is untrusted. Trust this folder to enable agent actions
          (NFR-D07).
        </div>
      )}

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <label className="label" htmlFor="task">
        Task
      </label>
      <textarea
        id="task"
        className="task"
        rows={3}
        value={task}
        disabled={streaming || !trusted}
        placeholder="e.g. Inspect schema via MCP and propose an index"
        onChange={(e) => setTask(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />

      <div className="row">
        <button
          type="button"
          onClick={submit}
          disabled={streaming || !trusted || !task.trim()}
        >
          Run
        </button>
        <button
          type="button"
          className="secondary"
          onClick={ping}
          disabled={streaming || !trusted}
        >
          Ping
        </button>
        <button
          type="button"
          className="secondary"
          onClick={cancel}
          disabled={!streaming}
        >
          Cancel
        </button>
        <button
          type="button"
          className="secondary"
          onClick={toggleAutonomy}
          disabled={!trusted}
          title="Low-friction auto-approves narrow edit_file only — never terminal, MCP write, or ccloud"
        >
          Autonomy: {autonomy === 'strict' ? 'strict' : 'low-friction'}
        </button>
      </div>

      {phase && <p className="phase">Phase: {phase}</p>}
      {cacheHint && <p className="phase">{cacheHint}</p>}

      {approval && (
        <div className="approval" role="dialog" aria-label="Approval required">
          <div className="approval-head">
            Approve {approval.toolName} ({approval.kind})
          </div>
          {approval.kind === 'command' ? (
            <pre className="diff">{approval.cmd}</pre>
          ) : (
            <>
              <p className="phase">{approval.path}</p>
              <div className="diff-grid">
                <pre className="diff before">{clip(approval.before ?? '', 4000)}</pre>
                <pre className="diff after">{clip(approval.after ?? '', 4000)}</pre>
              </div>
            </>
          )}
          <div className="row">
            <button type="button" onClick={approve}>
              Approve
            </button>
            <button type="button" className="secondary" onClick={reject}>
              Reject
            </button>
          </div>
        </div>
      )}

      {tools.length > 0 && (
        <ul className="cards">
          {tools.map((t) => (
            <li key={t.id}>
              <strong>{t.name}</strong> · {t.status}
              {t.detail ? ` — ${clip(t.detail, 120)}` : ''}
            </li>
          ))}
        </ul>
      )}

      {subagents.length > 0 && (
        <ul className="cards subagents">
          {subagents.map((s) => (
            <li key={s.id}>
              <strong>subagent:{s.name}</strong> · {s.status}
              {s.summary ? ` — ${clip(s.summary, 200)}` : ''}
            </li>
          ))}
        </ul>
      )}

      <pre className="transcript" aria-live="polite">
        {transcript || (streaming ? '…' : 'Output will stream here.')}
      </pre>
    </div>
  );
}
