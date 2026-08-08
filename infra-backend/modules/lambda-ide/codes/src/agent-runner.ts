/**
 * Bridge between the content pipeline and the agent loop.
 *
 * `publishContent` declares an `AgentRunner` and does not import one, so that
 * the pipeline stays testable without a model. This is the real implementation:
 * the WalkCroach IDE agent loop, over an in-memory filesystem, in additive mode.
 *
 * There is no sandbox here and that is deliberate. A publish run reads repo
 * conventions over the GitHub API, generates files, and opens a pull request —
 * the customer's own CI does the verifying. Nothing is executed, so nothing
 * needs provisioning, and the whole run fits comfortably inside a Lambda.
 */
import type { AgentRunner } from '@walkcroach/agent-harness';
import {
  MemoryFileSystem,
  runProgrammatic,
  type AgentEvent,
  type ProjectMemoryBridge,
  type WriteScope,
} from '@walkcroach/sdk-host';

export type RunnerOptions = {
  writeScope: WriteScope;
  memory?: ProjectMemoryBridge | null;
  /**
   * Bounded because nobody is watching. A publish run that has not produced a
   * page in this many iterations is not going to.
   */
  maxIterations?: number;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
};

export function createAgentRunner(opts: RunnerOptions): AgentRunner {
  return async ({
    files,
    workspaceRoot,
    prompt,
    context,
    answers,
    role,
    approvedPlan,
  }) => {
    const fs = new MemoryFileSystem({ files });
    const isPlan = role === 'plan';

    const result = await runProgrammatic({
      sandbox: fs,
      workspaceRoot,
      prompt,
      context,
      writeScope: opts.writeScope,
      memory: opts.memory ?? null,
      maxIterations: opts.maxIterations ?? (isPlan ? 12 : 24),
      signal: opts.signal,
      onEvent: opts.onEvent,
      answers,
      mode: isPlan ? 'plan' : 'full',
      planOnly: isPlan,
      approvedPlan: isPlan ? undefined : approvedPlan,
    });

    return {
      ok: result.ok,
      reason: result.reason,
      filesWritten: result.filesWritten,
      snapshot: fs.snapshot(),
      refusals: result.refusals,
      ...(result.inputRequired ? { inputRequired: result.inputRequired } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(result.approvedPlan ? { approvedPlan: result.approvedPlan } : {}),
    };
  };
}
