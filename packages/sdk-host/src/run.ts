/**
 * Drive the WalkCroach IDE agent loop from an API call.
 *
 * This is the whole point of the package: `runAgentLoop` is the same function
 * the VS Code extension and the CLI call. Nothing here reimplements planning,
 * tool dispatch, verification, or retries — it supplies a host and collects the
 * result.
 */
import { runAgentLoop, type AgentEvent, type ProjectMemoryBridge } from '@walkcroach/agent-engine';
import { SandboxHostAdapter } from './SandboxHostAdapter.js';
import { InputRequiredError } from './policy.js';
import type { SandboxLike } from './sandbox-contract.js';
import { describeScope, type WriteScope } from './write-scope.js';

export type RunRequest = {
  sandbox: SandboxLike;
  prompt: string;
  /** Required — see `write-scope.ts`. */
  writeScope: WriteScope;
  workspaceRoot?: string;
  memory?: ProjectMemoryBridge | null;
  /** Extra context prepended to the prompt: house style, ingested document, etc. */
  context?: string;
  onEvent?: (event: AgentEvent) => void;
  maxIterations?: number;
  signal?: AbortSignal;
  answers?: Record<string, string>;
  mode?: 'full' | 'plan';
};

export type RunResult = {
  ok: boolean;
  /** Why the loop stopped, as reported by the engine. */
  reason: string;
  /** Paths the run created or modified, workspace-relative. */
  filesWritten: string[];
  /** Everything policy or write-scope refused, for the caller to inspect. */
  refusals: Array<{ rule: string; reason: string; subject: string }>;
  events: AgentEvent[];
  /** Set when the loop needed a human decision it could not get. */
  inputRequired?: { question: string; options: string[] };
  error?: string;
};

/**
 * Assemble the prompt.
 *
 * The write-scope rule goes in **first and unconditionally**. A model that
 * learns the constraint by being refused mid-run burns iterations rediscovering
 * it, and — worse — may conclude the task is impossible and stop. Telling it up
 * front costs one paragraph.
 */
export function buildPrompt(params: {
  prompt: string;
  writeScope: WriteScope;
  context?: string;
}): string {
  return [
    '## Workspace rules',
    describeScope(params.writeScope),
    params.context ? `\n## Context\n${params.context}` : '',
    `\n## Task\n${params.prompt}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function runProgrammatic(req: RunRequest): Promise<RunResult> {
  const events: AgentEvent[] = [];
  const capture = (event: AgentEvent) => {
    events.push(event);
    req.onEvent?.(event);
  };

  const host = new SandboxHostAdapter({
    sandbox: req.sandbox,
    writeScope: req.writeScope,
    workspaceRoot: req.workspaceRoot,
    onEvent: capture,
    answers: req.answers,
  });

  let reason = 'unknown';
  let error: string | undefined;
  let inputRequired: RunResult['inputRequired'];

  try {
    await runAgentLoop({
      host,
      prompt: buildPrompt({
        prompt: req.prompt,
        writeScope: req.writeScope,
        context: req.context,
      }),
      mode: req.mode ?? 'full',
      // A programmatic run has no one to press "continue", so the iteration cap
      // is the only thing bounding cost. Deliberately lower than the IDE's.
      maxIterations: req.maxIterations ?? 24,
      projectMemory: req.memory ?? null,
      signal: req.signal,
      // Sub-agents are allowed: they keep exploratory noise out of the main
      // context window, which matters more without a human to steer.
      subagentsEnabled: true,
    });

    const done = [...events].reverse().find((e) => e.type === 'done');
    reason = done && done.type === 'done' ? done.reason : 'completed';
  } catch (err) {
    // Reached only if the loop itself rethrows, which it does for aborts.
    if (err instanceof InputRequiredError) {
      inputRequired = { question: err.question, options: err.options };
      reason = 'input_required';
      error = err.message;
    } else {
      reason = 'error';
      error = err instanceof Error ? err.message : String(err);
      capture({ type: 'error', message: error, fatal: true });
    }
  }

  /**
   * Checked after the loop rather than only in `catch`.
   *
   * `runAgentLoop` catches every non-abort error, emits `error` + `done`, and
   * returns normally — so a throw from `askUser` never propagates here. Relying
   * on the exception alone reported a completed run for one that actually
   * stalled on an unanswerable question, and `input_required` was unreachable.
   * The host records the fact; this reads it.
   *
   * Placed after the catch so it wins: needing input is a more precise
   * description of what happened than the generic error the loop emitted.
   */
  if (host.inputRequired) {
    inputRequired = host.inputRequired;
    reason = 'input_required';
    error = new InputRequiredError(
      host.inputRequired.question,
      host.inputRequired.options,
    ).message;
  }

  const fatal = events.some((e) => e.type === 'error' && e.fatal);

  return {
    ok: !error && !fatal && reason !== 'input_required',
    reason,
    filesWritten: host.writtenPaths(),
    refusals: host.refusals,
    events,
    ...(inputRequired ? { inputRequired } : {}),
    ...(error ? { error } : {}),
  };
}
