/**
 * Host-agnostic adapter. Implementations live in ide/ (vscode) and cli/.
 * This package must never import `vscode`.
 */

import type { AutonomyLevel } from './approvals.js';
import type { AgentTodo } from './todos.js';

export type TerminalChunk = {
  stream: 'stdout' | 'stderr';
  text: string;
  /** Set on the final chunk when the process exits. */
  exitCode?: number | null;
};

export type ApprovalDecision = 'approve' | 'reject';

export type SearchHit = {
  path: string;
  line: number;
  text: string;
};

export type UserQuestionAnswer = {
  selected: string;
  freeText?: string;
};

export type ApprovalRequest = {
  stepId: string;
  kind: 'diff' | 'command' | 'question';
  toolName: string;
  path?: string;
  before?: string;
  after?: string;
  cmd?: string;
  /** ask_user */
  question?: string;
  options?: string[];
  allowFreeText?: boolean;
  /** Original tool input (used by non-interactive approval gates). */
  input?: Record<string, unknown>;
};

export type AgentEvent =
  | { type: 'phase'; phase: 'gather' | 'act' | 'verify' }
  | { type: 'token_delta'; text: string }
  | {
      type: 'tool_card';
      id: string;
      name: string;
      status: 'pending' | 'running' | 'done' | 'error';
      detail?: string;
    }
  | {
      type: 'approval_request';
      request: ApprovalRequest;
    }
  | {
      type: 'subagent';
      id: string;
      name: string;
      status: 'running' | 'done' | 'error';
      summary?: string;
    }
  | { type: 'todos'; todos: AgentTodo[] }
  | { type: 'done'; reason: string; canContinue?: boolean }
  | { type: 'error'; message: string; fatal?: boolean }
  | { type: 'warning'; message: string }
  | {
      type: 'cache_usage';
      cacheReadInputTokens: number;
      cacheWriteInputTokens: number;
    }
  | {
      type: 'telemetry';
      name: string;
      counters?: Record<string, number>;
      detail?: string;
    };

export interface HostSecrets {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
}

export type RunTerminalOpts = {
  cwd: string;
  signal?: AbortSignal;
  /** Kill the process after this many ms (optional). */
  timeoutMs?: number;
  /** Tier A — raw stdin preload (exact bytes). */
  stdin?: string;
  /** Tier A — discrete reply lines (newline appended if missing). */
  replies?: string[];
  /**
   * Tier B — confirm-prompt bridge. When set, stdin stays open and idle
   * [y/N]-style prompts invoke this callback.
   */
  onConfirmPrompt?: (
    req: import('./terminal-prompts.js').ConfirmPromptRequest,
  ) => Promise<import('./terminal-prompts.js').ConfirmPromptAnswer>;
};

export type BackgroundTerminalStart = {
  taskId: string;
  pid: number;
  logPath: string;
  cmd: string;
};

export type BackgroundTerminalPoll = {
  taskId: string;
  status: 'running' | 'exited' | 'killed' | 'unknown';
  exitCode: number | null;
  logPath: string;
  logTail: string;
};

export interface HostAdapter {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<string[]>;
  search(
    pattern: string,
    opts?: { glob?: string; signal?: AbortSignal },
  ): Promise<SearchHit[]>;
  /** Match files by glob relative to workspace (e.g. ** / *.ts). */
  glob?(
    pattern: string,
    opts?: { signal?: AbortSignal },
  ): Promise<string[]>;
  applyDiff?(path: string, diff: string): Promise<void>;
  runTerminal(
    cmd: string,
    opts: RunTerminalOpts,
  ): AsyncIterable<TerminalChunk>;
  /** Start a long-running command without blocking the agent loop. */
  startBackgroundTerminal?(
    cmd: string,
    opts: { cwd: string },
  ): Promise<BackgroundTerminalStart>;
  pollBackgroundTerminal?(
    taskId: string,
  ): Promise<BackgroundTerminalPoll>;
  killBackgroundTerminal?(taskId: string): Promise<boolean>;
  /** Kill every tracked shell (blocking + background + sessions). Called on Stop. */
  killAllTerminals?(): void;
  /**
   * Tier C — interactive session (REPL/TUI). Prefer host registry over one-shot
   * run_terminal when the agent must write/read mid-run.
   */
  startTerminalSession?(params: {
    cmd: string;
    cwd: string;
    cols?: number;
    rows?: number;
  }): Promise<import('./pty-session.js').SessionInfo>;
  writeTerminalSession?(
    sessionId: string,
    input: string,
    opts?: { appendNewline?: boolean },
  ): Promise<void>;
  readTerminalSession?(
    sessionId: string,
    opts?: {
      timeoutMs?: number;
      settleMs?: number;
      maxChars?: number;
    },
  ): Promise<import('./pty-session.js').SessionReadResult>;
  closeTerminalSession?(sessionId: string): Promise<boolean>;
  listTerminalSessions?(): Promise<import('./pty-session.js').SessionInfo[]>;
  persistTodos?(todos: AgentTodo[]): Promise<void>;
  loadTodos?(): Promise<AgentTodo[] | null>;
  clearTodos?(): Promise<void>;
  /** P2 — disk-backed Bedrock session for resume after reload. */
  persistAgentSession?(snapshot: {
    sessionId: string;
    messages: import('@aws-sdk/client-bedrock-runtime').Message[];
    transcript?: string;
    createdAt?: string;
  }): Promise<{ sessionId: string }>;
  loadAgentSession?(): Promise<{
    sessionId: string;
    messages: import('@aws-sdk/client-bedrock-runtime').Message[];
    transcript: string;
    createdAt: string;
    updatedAt: string;
  } | null>;
  clearAgentSession?(): Promise<void>;
  /**
   * Request user approval for a file diff. Emits approval_request via emit.
   * Low-friction may short-circuit to approve for eligible edits.
   */
  showDiffPreview(
    path: string,
    before: string,
    after: string,
    meta?: {
      toolName?: string;
      stepId?: string;
      input?: Record<string, unknown>;
    },
  ): Promise<ApprovalDecision>;
  confirmCommand(
    cmd: string,
    meta?: { toolName?: string; stepId?: string },
  ): Promise<ApprovalDecision>;
  /**
   * Structured multiple-choice question (ask_user). Pauses until the user answers.
   */
  askUser(params: {
    question: string;
    options: string[];
    allowFreeText?: boolean;
    stepId?: string;
  }): Promise<UserQuestionAnswer>;
  /** Resolve a pending approval from the UI (APPROVE_STEP / REJECT_STEP). */
  resolveApproval(stepId: string, decision: ApprovalDecision): void;
  /** Resolve a pending ask_user question. */
  resolveQuestion(
    stepId: string,
    answer: UserQuestionAnswer | 'reject',
  ): void;
  getAutonomy(): AutonomyLevel;
  setAutonomy(level: AutonomyLevel): void;
  /** Optional gather helpers (read-only). */
  gatherMeta?(signal?: AbortSignal): Promise<{ gitStatus?: string }>;
  getWorkspaceRoot(): string | undefined;
  /** NFR-D07 — agentic tools must refuse untrusted workspaces. */
  isTrustedWorkspace(): boolean;
  secrets: HostSecrets;
  emit(event: AgentEvent): void;
}
