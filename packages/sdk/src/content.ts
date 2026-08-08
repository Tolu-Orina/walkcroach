import { ValidationError, WalkCroachError } from './errors.js';
import type { Transport } from './http.js';
import type { RunInterrupt } from './interrupt.js';
import {
  CONTENT_PUBLISH_CONTRACT_VERSION,
  type PlanApprovalPolicy,
} from './run-contract.js';
import type {
  DurableRunResult,
  GraphRunResult,
  PublishResult,
  PublishSource,
  RunEvent,
  RunSnapshot,
  RunStatus,
  WriteScope,
} from './types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export type PublishOptions = {
  /**
   * Optional. When omitted, the API ensures the reserved default SDK project
   * (`__walkcroach_sdk__`) for this credential.
   */
  projectId?: string;
  source: PublishSource;
  target?: {
    /** `owner/name`. Required for live publish; optional when `dryRun` is true. */
    repo?: string;
    /** Where posts live. Inferred from the repository when omitted. */
    path?: string;
  };
  /**
   * Required. `{ mode: 'additive' }` for publishing into a repo you do not own
   * the whole of — the generated pull request will contain only new files.
   */
  writeScope: WriteScope;
  /** Extra direction, e.g. "engineering blog, technical audience". */
  instructions?: string;
  /**
   * Produce the files and skip the pull request. When true, `target.repo` may
   * be omitted (no-target dry-run — API key only).
   */
  dryRun?: boolean;
  /**
   * Makes submission safe to retry. A repeat with the same key returns the
   * existing run rather than starting a second — without it a network blip
   * turns one blog post into two pull requests.
   */
  idempotencyKey?: string;
  /**
   * Plan approval policy (`content.publish/v1`).
   *
   * - Omit or `'auto'` — Plan stage **auto-approves** (A1). Async SDK runs have
   *   no live human channel for plan review; the Planner still runs.
   * - `'required'` — **rejected in v1** with {@link ValidationError}. Use the
   *   IDE for interactive `present_plan`. Reserved for a future contract once
   *   async HITL exists. Alias: `requirePlanApproval: true` → `'required'`.
   */
  planApproval?: PlanApprovalPolicy;
  /**
   * @deprecated Prefer {@link PublishOptions.planApproval} `'required'`.
   * When true, rejected on content.publish/v1 (same as planApproval: 'required').
   */
  requirePlanApproval?: boolean;
};

function normalizePublishResult(result: PublishResult): PublishResult {
  return {
    ...result,
    contractVersion: result.contractVersion ?? CONTENT_PUBLISH_CONTRACT_VERSION,
  };
}

function isPublishResult(result: DurableRunResult): result is PublishResult {
  return Array.isArray((result as PublishResult).filesWritten);
}

function normalizeDurableResult(result: DurableRunResult): DurableRunResult {
  if (isPublishResult(result)) return normalizePublishResult(result);
  const g = result as GraphRunResult;
  return {
    ...g,
    contractVersion: g.contractVersion ?? 'graph.run/v1',
  };
}

export class ContentApi {
  constructor(private readonly transport: Transport) {}

  /**
   * Turn a document into a page in the target repository, and open a pull
   * request for it.
   *
   * **Returns as soon as the run is accepted**, not when it finishes.
   * If the run pauses for human input, `wait` throws {@link RunInterruptedError};
   * call {@link RunHandle.resume} then `wait` again.
   */
  async publish(opts: PublishOptions): Promise<RunHandle> {
    const dryRun = Boolean(opts.dryRun);
    const repo = opts.target?.repo?.trim() ?? '';

    const planApproval: PlanApprovalPolicy =
      opts.planApproval ??
      (opts.requirePlanApproval === true ? 'required' : 'auto');
    if (planApproval === 'required') {
      throw new ValidationError(
        'requirePlanApproval / planApproval:"required" is not supported on content.publish/v1. ' +
          'The async SDK auto-approves Plan (A1). Use the IDE for interactive plan review.',
        400,
        null,
        { field: 'planApproval' },
      );
    }

    if (opts.projectId != null && opts.projectId !== '' && !UUID_RE.test(opts.projectId)) {
      throw new ValidationError('projectId must be a uuid', 400, null, {
        field: 'projectId',
      });
    }
    if (repo && !REPO_RE.test(repo)) {
      throw new ValidationError('target.repo must be in owner/name form', 400, null, {
        field: 'target.repo',
      });
    }
    if (!dryRun && !REPO_RE.test(repo)) {
      throw new ValidationError(
        'target.repo must be in owner/name form (omit only when dryRun is true)',
        400,
        null,
        { field: 'target.repo' },
      );
    }
    if (!opts.source?.content) {
      throw new ValidationError('source.content is required', 400, null, {
        field: 'source.content',
      });
    }
    if (!opts.writeScope?.mode) {
      throw new ValidationError(
        'writeScope is required — use { mode: "additive" } to guarantee no existing file is modified',
        400,
        null,
        { field: 'writeScope' },
      );
    }
    if (opts.writeScope.mode === 'scoped' && opts.writeScope.allow.length === 0) {
      throw new ValidationError(
        'writeScope.allow must list at least one path in scoped mode',
        400,
        null,
        { field: 'writeScope.allow' },
      );
    }

    const accepted = await this.transport.request<{
      runId: string;
      status: RunStatus;
      createdAt: string;
    }>('POST', '/v1/content/publish', {
      body: {
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
        source: opts.source,
        target: {
          ...(repo ? { repo } : {}),
          ...(opts.target?.path ? { path: opts.target.path } : {}),
        },
        writeScope: opts.writeScope,
        instructions: opts.instructions,
        dryRun,
        idempotencyKey: opts.idempotencyKey,
      },
    });

    return new RunHandle(this.transport, accepted.runId, accepted.status);
  }

  /** Re-attach to a run submitted earlier, in another process or another day. */
  run(runId: string): RunHandle {
    return new RunHandle(this.transport, runId, 'queued');
  }
}

const TERMINAL: readonly RunStatus[] = ['succeeded', 'failed', 'cancelled'];

/**
 * A submitted run.
 *
 * `threadId` is a LangGraph-style alias for `runId` (content runs).
 */
export class RunHandle {
  constructor(
    private readonly transport: Transport,
    readonly runId: string,
    public status: RunStatus,
  ) {}

  /** LangGraph-style thread id — equals runId for content runs. */
  get threadId(): string {
    return this.runId;
  }

  async poll(afterSeq = 0): Promise<RunSnapshot> {
    const snap = await this.transport.request<RunSnapshot>(
      'GET',
      `/v1/runs/${encodeURIComponent(this.runId)}`,
      { query: { afterSeq } },
    );
    this.status = snap.status;
    return snap;
  }

  /**
   * Wait for the run to finish.
   * Throws {@link RunInterruptedError} when paused for human input.
   *
   * `onProgress` receives every polled event. Prefer filtering with
   * `isStageProgressEvent` / `isCriticProgressEvent` / `isPlanProgressEvent`
   * from `@walkcroach/sdk` — engine tool noise may also appear on the channel.
   */
  async wait(opts: {
    onProgress?: (event: RunEvent) => void;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}): Promise<DurableRunResult> {
    const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
    let afterSeq = 0;

    for (;;) {
      if (opts.signal?.aborted) throw new WalkCroachError('wait aborted', 0, null);

      const snap = await this.poll(afterSeq);
      for (const event of snap.events) {
        afterSeq = event.seq;
        opts.onProgress?.(event);
      }

      if (snap.status === 'interrupted') {
        if (!snap.interrupt) {
          throw new WalkCroachError(
            `run ${this.runId} is interrupted but no interrupt payload was returned`,
            0,
            null,
          );
        }
        throw new RunInterruptedError(this.runId, snap.interrupt);
      }

      if (TERMINAL.includes(snap.status)) {
        if (snap.status === 'succeeded' && snap.result) {
          return normalizeDurableResult(snap.result);
        }
        throw new RunFailedError(this.runId, snap.status, snap.error ?? 'run did not succeed');
      }

      if (Date.now() > deadline) {
        throw new WalkCroachError(
          `run ${this.runId} did not finish within the wait timeout; it is still ${snap.status}. ` +
            `Poll again with wc.content.run("${this.runId}").`,
          0,
          null,
        );
      }

      await new Promise((r) => setTimeout(r, Math.max(500, snap.pollAfterMs || 2_000)));
    }
  }

  /** Continue after an interrupt; call {@link wait} again for the terminal result. */
  async resume(opts: { interruptId: string; value: unknown }): Promise<void> {
    if (!opts.interruptId?.trim()) {
      throw new ValidationError('interruptId is required', 400, null, {
        field: 'interruptId',
      });
    }
    if (opts.value === undefined) {
      throw new ValidationError('value is required', 400, null, { field: 'value' });
    }
    await this.transport.request('POST', `/v1/runs/${encodeURIComponent(this.runId)}/resume`, {
      body: {
        interruptId: opts.interruptId.trim(),
        value: opts.value,
      },
    });
    this.status = 'queued';
  }

  async cancel(): Promise<void> {
    await this.transport.request('DELETE', `/v1/runs/${encodeURIComponent(this.runId)}`);
    this.status = 'cancelled';
  }
}

export class RunFailedError extends WalkCroachError {
  constructor(
    readonly runId: string,
    readonly runStatus: RunStatus,
    message: string,
  ) {
    super(message, 0, null);
    this.name = 'RunFailedError';
  }
}

/** Thrown by {@link RunHandle.wait} when the run pauses for human input. */
export class RunInterruptedError extends WalkCroachError {
  constructor(
    readonly runId: string,
    readonly interrupt: RunInterrupt,
  ) {
    super(
      `run ${runId} interrupted (${interrupt.kind}); resume with interruptId=${interrupt.id}`,
      0,
      null,
    );
    this.name = 'RunInterruptedError';
  }

  get threadId(): string {
    return this.runId;
  }
}
