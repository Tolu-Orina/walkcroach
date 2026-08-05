import { ValidationError, WalkCroachError } from './errors.js';
import type { Transport } from './http.js';
import type {
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
  projectId: string;
  source: PublishSource;
  target: {
    /** `owner/name`. Must have the WalkCroach GitHub App installed. */
    repo: string;
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
  /** Produce the files and skip the pull request. */
  dryRun?: boolean;
  /**
   * Makes submission safe to retry. A repeat with the same key returns the
   * existing run rather than starting a second — without it a network blip
   * turns one blog post into two pull requests.
   */
  idempotencyKey?: string;
};

export class ContentApi {
  constructor(private readonly transport: Transport) {}

  /**
   * Turn a document into a page in the target repository, and open a pull
   * request for it.
   *
   * The agent reads the repository's own conventions first — `AGENTS.md` if
   * present, then tsconfig aliases, class-name helper, UI kit, router shape —
   * and applies anything this project has previously confirmed to memory. What
   * it learns is written back, so the fiftieth post matches the first.
   *
   * **Returns as soon as the run is accepted**, not when it finishes. A publish
   * takes minutes and no HTTP request survives that. Await the handle to wait
   * for the result:
   *
   * ```ts
   * const run = await wc.content.publish({ … });
   * const result = await run.wait({ onProgress: (e) => console.log(e.type) });
   * ```
   *
   * Pass `idempotencyKey` and a retried submit returns the same run instead of
   * starting a second — without it, a flaky network turns one post into two
   * pull requests.
   */
  async publish(opts: PublishOptions): Promise<RunHandle> {
    if (!opts.projectId || !UUID_RE.test(opts.projectId)) {
      throw new ValidationError('projectId must be a uuid', 400, null, {
        field: 'projectId',
      });
    }
    if (!REPO_RE.test(opts.target?.repo ?? '')) {
      throw new ValidationError('target.repo must be in owner/name form', 400, null, {
        field: 'target.repo',
      });
    }
    if (!opts.source?.content) {
      throw new ValidationError('source.content is required', 400, null, {
        field: 'source.content',
      });
    }
    // No default: choosing this is the caller's decision, not ours.
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
        projectId: opts.projectId,
        source: opts.source,
        target: opts.target,
        writeScope: opts.writeScope,
        instructions: opts.instructions,
        dryRun: opts.dryRun,
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
 * Holds no state beyond the id, so it survives being serialised, stored, and
 * resumed from a different process — which is the point of an async model.
 */
export class RunHandle {
  constructor(
    private readonly transport: Transport,
    readonly runId: string,
    public status: RunStatus,
  ) {}

  /** One poll. Pass `afterSeq` to receive only events you have not seen. */
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
   *
   * Backoff comes from the server (`pollAfterMs`) rather than being guessed
   * here, so it can be tuned without shipping a new client. `timeoutMs` bounds
   * the wait, not the run: timing out here leaves the run going, and the handle
   * can be awaited again.
   */
  async wait(opts: {
    onProgress?: (event: RunEvent) => void;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}): Promise<PublishResult> {
    const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
    let afterSeq = 0;

    for (;;) {
      if (opts.signal?.aborted) throw new WalkCroachError('wait aborted', 0, null);

      const snap = await this.poll(afterSeq);
      for (const event of snap.events) {
        afterSeq = event.seq;
        opts.onProgress?.(event);
      }

      if (TERMINAL.includes(snap.status)) {
        if (snap.status === 'succeeded' && snap.result) return snap.result;
        throw new RunFailedError(this.runId, snap.status, snap.error ?? 'run did not succeed');
      }

      if (Date.now() > deadline) {
        // The run is still going; only this wait gave up.
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

  /** Ask the worker to stop. Already-finished runs report 409. */
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
