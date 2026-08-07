import { randomUUID } from 'node:crypto';
import type {
  ApprovalDecision,
  ApprovalRequest,
  HostAdapter,
  UserQuestionAnswer,
} from './host.js';
import type { AutonomyLevel } from './approvals.js';
import { shouldAutoApprove, isCriticalCommand } from './approvals.js';
import type { TelemetrySink } from './telemetry.js';

export type ApprovalControllerOptions = {
  /**
   * Fleet / multi-session id. When set, resolveApproval must present the same
   * sessionId (or omit it for single-session hosts). Cross-session resolves are
   * ignored — this is the load-bearing fix for Desktop fleet cross-approve.
   */
  sessionId?: string;
  telemetry?: TelemetrySink | null;
};

/**
 * Mixin-style approval gate for HostAdapter implementations.
 */
export class ApprovalController {
  private autonomy: AutonomyLevel = 'strict';
  private readonly pending = new Map<
    string,
    {
      resolve: (d: ApprovalDecision) => void;
      reject: (err: Error) => void;
      sessionId?: string;
      openedAt: number;
    }
  >();
  private readonly pendingQuestions = new Map<
    string,
    {
      resolve: (d: UserQuestionAnswer) => void;
      reject: (err: Error) => void;
      sessionId?: string;
    }
  >();
  private readonly sessionId: string | undefined;
  private readonly telemetry: TelemetrySink | null | undefined;

  constructor(
    private readonly emitApproval: (req: ApprovalRequest) => void,
    opts?: ApprovalControllerOptions,
  ) {
    this.sessionId = opts?.sessionId;
    this.telemetry = opts?.telemetry;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  getAutonomy(): AutonomyLevel {
    return this.autonomy;
  }

  setAutonomy(level: AutonomyLevel): void {
    this.autonomy = level;
  }

  /**
   * Resolve a pending approval. When this controller is session-scoped and the
   * caller supplies a different sessionId, the resolve is a no-op (fleet must
   * not cross-approve).
   */
  resolveApproval(
    stepId: string,
    decision: ApprovalDecision,
    sessionId?: string,
  ): void {
    if (
      this.sessionId != null &&
      sessionId != null &&
      sessionId !== this.sessionId
    ) {
      return;
    }
    const entry = this.pending.get(stepId);
    if (!entry) return;
    if (
      entry.sessionId != null &&
      sessionId != null &&
      sessionId !== entry.sessionId
    ) {
      return;
    }
    this.pending.delete(stepId);
    this.telemetry?.recordApprovalWait({
      kind: 'approval',
      outcome: 'resolved',
      waitMs: Date.now() - entry.openedAt,
    });
    entry.resolve(decision);
  }

  resolveQuestion(
    stepId: string,
    answer: UserQuestionAnswer | 'reject',
    sessionId?: string,
  ): void {
    if (
      this.sessionId != null &&
      sessionId != null &&
      sessionId !== this.sessionId
    ) {
      return;
    }
    const entry = this.pendingQuestions.get(stepId);
    if (!entry) return;
    if (
      entry.sessionId != null &&
      sessionId != null &&
      sessionId !== entry.sessionId
    ) {
      return;
    }
    this.pendingQuestions.delete(stepId);
    if (answer === 'reject') {
      // Soft dismiss — return a normal answer so the agent can continue.
      // Do NOT AbortError: that cancels the entire run.
      entry.resolve({ selected: '(skipped)' });
      return;
    }
    entry.resolve(answer);
  }

  cancelAll(reason = 'cancelled'): void {
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      this.telemetry?.recordApprovalWait({
        kind: 'approval',
        outcome: 'abandoned',
        waitMs: Date.now() - entry.openedAt,
      });
      entry.reject(new DOMException(reason, 'AbortError'));
    }
    for (const [id, entry] of this.pendingQuestions) {
      this.pendingQuestions.delete(id);
      entry.reject(new DOMException(reason, 'AbortError'));
    }
  }

  async requestDiff(params: {
    path: string;
    before: string;
    after: string;
    toolName: string;
    input: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<ApprovalDecision> {
    if (
      shouldAutoApprove({
        autonomy: this.autonomy,
        toolName: params.toolName,
        input: params.input,
      })
    ) {
      return 'approve';
    }

    const stepId = randomUUID();
    const request: ApprovalRequest = {
      stepId,
      sessionId: this.sessionId,
      kind: 'diff',
      toolName: params.toolName,
      path: params.path,
      before: params.before,
      after: params.after,
      input: params.input,
    };
    return this.wait(stepId, request, params.signal);
  }

  async requestCommand(params: {
    cmd: string;
    toolName: string;
    signal?: AbortSignal;
  }): Promise<ApprovalDecision> {
    // Critical/infra never auto — use isCriticalCommand (covers infra + destructive).
    // Previously only isInfraCommand was hard-gated here, which let low_friction
    // auto-approve rm -rf / sudo / force-push when shouldAutoApprove was bypassed.
    if (isCriticalCommand(params.cmd)) {
      // fall through to explicit approve
    } else if (
      shouldAutoApprove({
        autonomy: this.autonomy,
        toolName: params.toolName,
        input: { cmd: params.cmd },
      })
    ) {
      return 'approve';
    }
    const stepId = randomUUID();
    const request: ApprovalRequest = {
      stepId,
      sessionId: this.sessionId,
      kind: 'command',
      toolName: params.toolName,
      cmd: params.cmd,
    };
    return this.wait(stepId, request, params.signal);
  }

  async requestQuestion(params: {
    question: string;
    options: string[];
    allowFreeText?: boolean;
    toolName?: string;
    signal?: AbortSignal;
  }): Promise<UserQuestionAnswer> {
    const stepId = randomUUID();
    const request: ApprovalRequest = {
      stepId,
      sessionId: this.sessionId,
      kind: 'question',
      toolName: params.toolName ?? 'ask_user',
      question: params.question,
      options: params.options,
      allowFreeText: params.allowFreeText,
    };
    return new Promise<UserQuestionAnswer>((resolve, reject) => {
      if (params.signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const onAbort = () => {
        this.pendingQuestions.delete(stepId);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      params.signal?.addEventListener('abort', onAbort, { once: true });
      this.pendingQuestions.set(stepId, {
        sessionId: this.sessionId,
        resolve: (d) => {
          params.signal?.removeEventListener('abort', onAbort);
          resolve(d);
        },
        reject: (err) => {
          params.signal?.removeEventListener('abort', onAbort);
          reject(err);
        },
      });
      this.emitApproval(request);
    });
  }

  private wait(
    stepId: string,
    request: ApprovalRequest,
    signal?: AbortSignal,
  ): Promise<ApprovalDecision> {
    this.telemetry?.recordApprovalWait({
      kind: request.kind,
      outcome: 'waiting',
    });
    return new Promise<ApprovalDecision>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const onAbort = () => {
        const entry = this.pending.get(stepId);
        this.pending.delete(stepId);
        if (entry) {
          this.telemetry?.recordApprovalWait({
            kind: request.kind,
            outcome: 'abandoned',
            waitMs: Date.now() - entry.openedAt,
          });
        }
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(stepId, {
        sessionId: this.sessionId,
        openedAt: Date.now(),
        resolve: (d) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(d);
        },
        reject: (err) => {
          signal?.removeEventListener('abort', onAbort);
          reject(err);
        },
      });
      this.emitApproval(request);
    });
  }
}

/**
 * Routes resolveApproval to the correct session-scoped controller.
 * Use when a host owns multiple concurrent fleet sessions.
 */
export class FleetApprovalRouter {
  private readonly bySession = new Map<string, ApprovalController>();

  register(sessionId: string, gate: ApprovalController): void {
    this.bySession.set(sessionId, gate);
  }

  unregister(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  resolveApproval(
    stepId: string,
    decision: ApprovalDecision,
    sessionId?: string,
  ): boolean {
    if (sessionId) {
      const gate = this.bySession.get(sessionId);
      if (!gate) return false;
      gate.resolveApproval(stepId, decision, sessionId);
      return true;
    }
    // Ambiguous without sessionId: refuse to guess across the fleet.
    if (this.bySession.size > 1) return false;
    const only = this.bySession.values().next().value as
      | ApprovalController
      | undefined;
    if (!only) return false;
    only.resolveApproval(stepId, decision);
    return true;
  }

  get(sessionId: string): ApprovalController | undefined {
    return this.bySession.get(sessionId);
  }
}

/** Wire HostAdapter approval methods onto an ApprovalController. */
export function bindApprovals(
  host: Pick<HostAdapter, 'emit'>,
  gate: ApprovalController,
  signal?: () => AbortSignal | undefined,
): Pick<
  HostAdapter,
  | 'showDiffPreview'
  | 'confirmCommand'
  | 'askUser'
  | 'resolveApproval'
  | 'resolveQuestion'
  | 'getAutonomy'
  | 'setAutonomy'
> {
  return {
    showDiffPreview: (path, before, after, meta) =>
      gate.requestDiff({
        path,
        before,
        after,
        toolName: meta?.toolName ?? 'write_file',
        input: meta?.input ?? { path, before, after },
        signal: signal?.(),
      }),
    confirmCommand: (cmd, meta) =>
      gate.requestCommand({
        cmd,
        toolName: meta?.toolName ?? 'run_terminal',
        signal: signal?.(),
      }),
    askUser: (params) =>
      gate.requestQuestion({
        question: params.question,
        options: params.options,
        allowFreeText: params.allowFreeText,
        toolName: 'ask_user',
        signal: signal?.(),
      }),
    resolveApproval: (stepId, decision, sessionId) =>
      gate.resolveApproval(stepId, decision, sessionId),
    resolveQuestion: (stepId, answer, sessionId) =>
      gate.resolveQuestion(stepId, answer, sessionId),
    getAutonomy: () => gate.getAutonomy(),
    setAutonomy: (level) => gate.setAutonomy(level),
  };
}
