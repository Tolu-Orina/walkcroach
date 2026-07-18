import { randomUUID } from 'node:crypto';
import type {
  ApprovalDecision,
  ApprovalRequest,
  HostAdapter,
} from './host.js';
import type { AutonomyLevel } from './approvals.js';
import { shouldAutoApprove, isInfraCommand } from './approvals.js';

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
    }
  >();

  constructor(private readonly emitApproval: (req: ApprovalRequest) => void) {}

  getAutonomy(): AutonomyLevel {
    return this.autonomy;
  }

  setAutonomy(level: AutonomyLevel): void {
    this.autonomy = level;
  }

  resolveApproval(stepId: string, decision: ApprovalDecision): void {
    const entry = this.pending.get(stepId);
    if (!entry) return;
    this.pending.delete(stepId);
    entry.resolve(decision);
  }

  cancelAll(reason = 'cancelled'): void {
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
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
    // Terminal is never auto-approved (FR-D05 / infra forever).
    if (isInfraCommand(params.cmd)) {
      // still requires explicit approve — never auto
    }
    const stepId = randomUUID();
    const request: ApprovalRequest = {
      stepId,
      kind: 'command',
      toolName: params.toolName,
      cmd: params.cmd,
    };
    return this.wait(stepId, request, params.signal);
  }

  private wait(
    stepId: string,
    request: ApprovalRequest,
    signal?: AbortSignal,
  ): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const onAbort = () => {
        this.pending.delete(stepId);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(stepId, {
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

/** Wire HostAdapter approval methods onto an ApprovalController. */
export function bindApprovals(
  host: Pick<HostAdapter, 'emit'>,
  gate: ApprovalController,
  signal?: () => AbortSignal | undefined,
): Pick<
  HostAdapter,
  | 'showDiffPreview'
  | 'confirmCommand'
  | 'resolveApproval'
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
    resolveApproval: (stepId, decision) => gate.resolveApproval(stepId, decision),
    getAutonomy: () => gate.getAutonomy(),
    setAutonomy: (level) => gate.setAutonomy(level),
  };
}
