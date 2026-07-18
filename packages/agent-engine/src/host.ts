/**
 * Host-agnostic adapter. Implementations live in ide/ (vscode) and cli/.
 * This package must never import `vscode`.
 */

import type { AutonomyLevel } from './approvals.js';

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

export type ApprovalRequest = {
  stepId: string;
  kind: 'diff' | 'command';
  toolName: string;
  path?: string;
  before?: string;
  after?: string;
  cmd?: string;
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
  | { type: 'done'; reason: string }
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

export interface HostAdapter {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<string[]>;
  search(
    pattern: string,
    opts?: { glob?: string; signal?: AbortSignal },
  ): Promise<SearchHit[]>;
  applyDiff?(path: string, diff: string): Promise<void>;
  runTerminal(
    cmd: string,
    opts: { cwd: string; signal?: AbortSignal },
  ): AsyncIterable<TerminalChunk>;
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
  /** Resolve a pending approval from the UI (APPROVE_STEP / REJECT_STEP). */
  resolveApproval(stepId: string, decision: ApprovalDecision): void;
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
