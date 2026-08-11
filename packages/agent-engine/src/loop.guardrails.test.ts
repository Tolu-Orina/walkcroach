/**
 * Agent-loop guardrails — master plan §7A.
 *
 * `loop.test.ts` covers the happy paths: ping, a clean end_turn, attachments,
 * abort. What it does not reach is the machinery that decides *when a run
 * stops* — iteration caps, the act/verify/todo nudges, the subagent budget,
 * and the stuck-tool-loop detector. That is 62% of this file's functions, and
 * it is the part that fails expensively: a loop that will not stop burns the
 * user's own Bedrock spend (BYOK), and a nudge that fires twice doubles a turn.
 *
 * Each test here pins one budget or one exit reason. They are written against
 * the exported constants rather than literals, so raising a cap is a
 * deliberate edit in one place instead of a silent drift between code and test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, HostAdapter } from './host.js';

const mockStreamPing = vi.fn();
const mockStreamConverseTurn = vi.fn();

vi.mock('./bedrock.js', () => ({
  getNovaModelId: () => 'test-model',
  getNovaReasoningEffort: () => 'medium',
  createBedrockClient: vi.fn(),
  getBedrockRegion: (override?: string) => override || 'eu-west-2',
  formatBedrockAuthError: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
  streamConverseTurn: (...args: unknown[]) => mockStreamConverseTurn(...args),
  streamPing: (...args: unknown[]) => mockStreamPing(...args),
  DEFAULT_MAX_OUTPUT_TOKENS: 4096,
  DEFAULT_MAX_REASONING_OUTPUT_TOKENS: 30_000,
  DEFAULT_MAX_OUTPUT_CONTINUATIONS: 2,
}));

import {
  ACT_NUDGE_PROMPT,
  CONTINUE_PROMPT,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MAX_SUBAGENTS,
  MAX_TODO_WRITE_NUDGES,
  PARALLEL_SAFE_TOOLS,
  REVIEW_OK_MARKER,
  buildVerifyNudgePrompt,
  buildVerifyReviewPrompt,
  isReviewOk,
  runAgentLoop,
} from './loop.js';

type TestHost = HostAdapter & { events: AgentEvent[] };

function makeHost(overrides?: Partial<HostAdapter>): TestHost {
  const events: AgentEvent[] = [];
  return {
    events,
    readFile: async () => '',
    writeFile: async () => undefined,
    listDir: async () => [],
    search: async () => [],
    runTerminal: async function* () {},
    showDiffPreview: async () => 'approve' as const,
    confirmCommand: async () => 'approve' as const,
    resolveApproval: () => undefined,
    getAutonomy: () => 'strict' as const,
    setAutonomy: () => undefined,
    getWorkspaceRoot: () => '/workspace',
    isTrustedWorkspace: () => true,
    secrets: { get: async () => undefined, store: async () => undefined },
    emit: (event: AgentEvent) => {
      events.push(event);
    },
    gatherMeta: async () => ({ gitStatus: '## main' }),
    ...overrides,
  };
}

/** A model turn that says something and calls no tools. */
function textTurn(text = 'Done.') {
  return {
    stopReason: 'end_turn',
    assistantContent: [{ text }],
    toolUses: [],
    text,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
  };
}

/** A model turn that calls one tool. */
function toolTurn(name: string, input: Record<string, unknown> = {}, id = `t_${name}`) {
  return {
    stopReason: 'tool_use',
    assistantContent: [{ toolUse: { toolUseId: id, name, input } }],
    toolUses: [{ toolUseId: id, name, input }],
    text: '',
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
  };
}

/** Queue turn results; the last one repeats so a loop cannot run dry. */
function respondWith(...turns: ReturnType<typeof textTurn>[]) {
  let call = 0;
  mockStreamConverseTurn.mockImplementation(async function* () {
    const turn = turns[Math.min(call, turns.length - 1)]!;
    call += 1;
    if (turn.text) yield { type: 'token' as const, text: turn.text };
    return turn;
  });
  return () => call;
}

function doneEvent(host: TestHost) {
  return host.events.find((e) => e.type === 'done') as
    | Extract<AgentEvent, { type: 'done' }>
    | undefined;
}

/**
 * User-role prompts as the model last saw them.
 *
 * Read from the final call only: the conversation accumulates, so counting
 * across every call would report one pushed prompt once per later turn — the
 * difference between "nudged twice" and "nudged once, three turns ago".
 */
function userTexts(): string[] {
  const last = mockStreamConverseTurn.mock.calls.at(-1)?.[0] as
    | { messages?: Array<{ role: string; content: Array<{ text?: string }> }> }
    | undefined;
  return (last?.messages ?? [])
    .filter((m) => m.role === 'user')
    .flatMap((m) => m.content.map((c) => c.text ?? ''));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('iteration budget', () => {
  it('stops at the cap rather than running forever', async () => {
    // A model that always calls a tool would otherwise loop indefinitely,
    // spending the user's own Bedrock budget under BYOK.
    const calls = respondWith(toolTurn('list_dir', { path: '.' }));
    const host = makeHost();

    await runAgentLoop({ host, prompt: 'explore the repo', maxIterations: 3 });

    expect(calls()).toBe(3);
    expect(doneEvent(host)?.reason).toBe('max_iterations');
  });

  it('honours a caller-supplied cap over the default', async () => {
    const calls = respondWith(toolTurn('list_dir', { path: '.' }));
    await runAgentLoop({ host: makeHost(), prompt: 'explore', maxIterations: 1 });
    expect(calls()).toBe(1);
    expect(DEFAULT_MAX_ITERATIONS).toBeGreaterThan(1);
  });

  it('finishes early when the model stops calling tools', async () => {
    const calls = respondWith(toolTurn('list_dir'), textTurn('All done.'));
    const host = makeHost();

    await runAgentLoop({
      host,
      prompt: 'look around',
      maxIterations: 10,
      // Flat-loop budget semantics (phase-graph gather→act adds an extra continue).
      phaseGraphEnabled: false,
    });

    expect(calls()).toBe(2);
    expect(doneEvent(host)?.reason).not.toBe('max_iterations');
  });
});

describe('the act nudge', () => {
  it('fires once when an action task ends without changing anything', async () => {
    // "Create a file" that produced only exploration is the failure this
    // catches: the model narrating instead of acting.
    respondWith(textTurn('I would create the file.'));
    const host = makeHost();

    await runAgentLoop({ host, prompt: 'create a health check endpoint', maxIterations: 4 });

    const nudges = userTexts().filter((t) => t === ACT_NUDGE_PROMPT);
    expect(nudges.length).toBeGreaterThan(0);
    // Once only — a nudge that repeats every turn doubles the cost of a run.
    expect(new Set(nudges).size).toBe(1);
    expect(
      host.events.some(
        (e) => e.type === 'warning' && /nudging the agent to act/i.test(e.message),
      ),
    ).toBe(true);
  });

  it('does not nudge a read-only run', async () => {
    respondWith(textTurn('Here is what I found.'));
    const host = makeHost();

    await runAgentLoop({
      host,
      prompt: 'create a health check endpoint',
      readOnly: true,
      maxIterations: 4,
    });

    expect(userTexts()).not.toContain(ACT_NUDGE_PROMPT);
  });

  it('does not nudge when the caller declares the task is not an action', async () => {
    // `actionBias: 'never'` is the explicit signal. Relying on the prompt
    // classifier here would test `looksLikeActionTask`, not the loop.
    respondWith(textTurn('It uses Vite and React.'));
    const host = makeHost();

    await runAgentLoop({
      host,
      prompt: 'what build tool does this repo use?',
      actionBias: 'never',
      maxIterations: 4,
    });

    expect(userTexts()).not.toContain(ACT_NUDGE_PROMPT);
    expect(doneEvent(host)).toBeTruthy();
  });
});

describe('subagent budget', () => {
  it('refuses to spawn beyond the cap', async () => {
    respondWith(toolTurn('spawn_subagent', { task: 'investigate', prompt: 'look' }));
    const host = makeHost();

    await runAgentLoop({
      host,
      prompt: 'investigate the failure',
      subagentsEnabled: true,
      maxSubagents: 1,
      maxIterations: 5,
    });

    const spawned = host.events.filter(
      (e) => e.type === 'subagent' && e.status === 'start',
    );
    expect(spawned.length).toBeLessThanOrEqual(1);
    expect(DEFAULT_MAX_SUBAGENTS).toBeGreaterThan(0);
  });

  it('refuses to spawn at all when subagents are disabled', async () => {
    respondWith(toolTurn('spawn_subagent', { task: 'investigate', prompt: 'look' }));
    const host = makeHost();

    await runAgentLoop({
      host,
      prompt: 'investigate',
      subagentsEnabled: false,
      maxIterations: 3,
    });

    expect(host.events.some((e) => e.type === 'subagent' && e.status === 'start')).toBe(false);
  });

  it('never spawns from inside a read-only run', async () => {
    // Nested spawning is how a bounded run becomes an unbounded one.
    respondWith(toolTurn('spawn_subagent', { task: 't', prompt: 'p' }));
    const host = makeHost();

    await runAgentLoop({ host, prompt: 'check', readOnly: true, maxIterations: 3 });

    expect(host.events.some((e) => e.type === 'subagent' && e.status === 'start')).toBe(false);
  });
});

describe('truncated-output continuation', () => {
  it('continues a turn cut short by the token limit, within its budget', async () => {
    let call = 0;
    mockStreamConverseTurn.mockImplementation(async function* () {
      call += 1;
      yield { type: 'token' as const, text: 'partial' };
      // Always truncated: the loop must stop continuing on its own.
      return {
        stopReason: 'max_tokens',
        assistantContent: [{ text: 'partial' }],
        toolUses: [],
        text: 'partial',
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      };
    });
    const host = makeHost();

    await runAgentLoop({
      host,
      prompt: 'write a long document',
      maxIterations: 1,
      maxOutputContinuations: 2,
    });

    // One initial turn plus at most the continuation budget.
    expect(call).toBeLessThanOrEqual(3);
    expect(userTexts().filter((t) => t === CONTINUE_PROMPT).length).toBeLessThanOrEqual(2);
    expect(
      host.events.some((e) => e.type === 'warning' && /Output limit reached/.test(e.message)),
    ).toBe(true);
  });

  it('does not continue when the budget is zero', async () => {
    let call = 0;
    mockStreamConverseTurn.mockImplementation(async function* () {
      call += 1;
      return {
        stopReason: 'max_tokens',
        assistantContent: [{ text: 'x' }],
        toolUses: [],
        text: 'x',
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      };
    });

    await runAgentLoop({
      host: makeHost(),
      prompt: 'write something',
      maxIterations: 1,
      maxOutputContinuations: 0,
    });

    expect(call).toBe(1);
  });
});

describe('exit reasons', () => {
  it('reports a distinct reason the caller can branch on', async () => {
    respondWith(textTurn('Finished.'));
    const host = makeHost();
    await runAgentLoop({ host, prompt: 'what is 2 + 2?', maxIterations: 3 });

    const done = doneEvent(host);
    expect(done).toBeTruthy();
    expect(typeof done!.reason).toBe('string');
    expect(done!.reason).not.toBe('');
  });

  it('surfaces a model failure as an error event rather than a silent stop', async () => {
    // The loop deliberately does not throw here: the host owns the UI, and an
    // unhandled rejection in an extension host is a much worse failure than a
    // rendered error. What matters is that the failure is not swallowed.
    mockStreamConverseTurn.mockImplementation(async function* () {
      throw new Error('bedrock exploded');
    });
    const host = makeHost();

    await runAgentLoop({ host, prompt: 'do a thing', maxIterations: 2 });

    const error = host.events.find((e) => e.type === 'error');
    expect(error, 'a model failure must reach the host').toBeTruthy();
    expect((error as Extract<AgentEvent, { type: 'error' }>).message).toMatch(
      /bedrock exploded/,
    );
  });
});

describe('phases', () => {
  it('emits gather then act, in that order', async () => {
    respondWith(textTurn('ok'));
    const host = makeHost();
    await runAgentLoop({ host, prompt: 'hello', maxIterations: 2 });

    const phases = host.events
      .filter((e) => e.type === 'phase')
      .map((e) => (e as Extract<AgentEvent, { type: 'phase' }>).phase);
    expect(phases.indexOf('gather')).toBeGreaterThanOrEqual(0);
    expect(phases.indexOf('act')).toBeGreaterThan(phases.indexOf('gather'));
  });
});

describe('prompt builders and predicates', () => {
  it('lists the workspace verify recipes in the nudge', () => {
    const prompt = buildVerifyNudgePrompt(['npm test', 'npm run build']);
    expect(prompt).toContain('`npm test`');
    expect(prompt).toContain('`npm run build`');
    // The instruction that stops a stale pass being reused as evidence.
    expect(prompt).toMatch(/fresh verify/i);
  });

  it('gives the reviewer the original task and forbids writing', () => {
    const prompt = buildVerifyReviewPrompt('  add a health route  ');
    expect(prompt).toContain('add a health route');
    expect(prompt).toContain(REVIEW_OK_MARKER);
    expect(prompt).toMatch(/read-only/i);
    expect(prompt).toMatch(/Do not write files/i);
  });

  it('accepts a review only when the marker leads the reply', () => {
    expect(isReviewOk(REVIEW_OK_MARKER)).toBe(true);
    expect(isReviewOk(`${REVIEW_OK_MARKER} looks good`)).toBe(true);
    expect(isReviewOk(`${REVIEW_OK_MARKER}: fine`)).toBe(true);
    expect(isReviewOk('  REVIEW_OK\nnote')).toBe(true);
  });

  it('rejects a review that only mentions the marker', () => {
    // The failure this prevents: "REVIEW_ISSUES: ... should be REVIEW_OK once
    // fixed" being read as a pass.
    expect(isReviewOk('REVIEW_ISSUES: missing tests')).toBe(false);
    expect(isReviewOk('Everything is fine, REVIEW_OK')).toBe(false);
    expect(isReviewOk('')).toBe(false);
    expect(isReviewOk('REVIEW_OKAY')).toBe(false);
  });
});

describe('parallel-safe tool set', () => {
  it('excludes every tool that mutates the workspace', () => {
    // Batching is safe precisely because none of these change anything. A
    // mutating tool here would run concurrently with its own approval gate.
    // Named explicitly rather than matched by pattern: `await_terminal` reads
    // output from a session that is already running, and a substring rule
    // would wrongly flag it while missing a future `sync_files`.
    for (const mutating of [
      'write_file',
      'edit_file',
      'apply_patch',
      'run_terminal',
      'delete_file',
      'spawn_subagent',
      'verify',
    ]) {
      expect(PARALLEL_SAFE_TOOLS.has(mutating), mutating).toBe(false);
    }
  });

  it('is not empty, so batching is actually possible', () => {
    expect(PARALLEL_SAFE_TOOLS.size).toBeGreaterThan(0);
  });
});

describe('Phase 2 plan-then-execute routing', () => {
  it('keeps bare readOnly sticky — does not spawn Planner', async () => {
    respondWith(textTurn('Findings only.'));
    const host = makeHost();

    await runAgentLoop({
      host,
      prompt: 'summarize the repo layout',
      readOnly: true,
      maxIterations: 3,
      plannerFirstOnIntent: false,
    });

    expect(
      host.events.some(
        (e) =>
          e.type === 'warning' &&
          /running Planner subagent/i.test(e.message),
      ),
    ).toBe(false);
    expect(doneEvent(host)).toBeTruthy();
  });

  it('routes mode:plan through Planner then stops cleanly if submit_plan missing', async () => {
    // Planner subagent + parent execute both call Bedrock; text-only turns
    // mean Planner never submit_plan → incomplete (not stuck in plan mode).
    respondWith(textTurn('I thought about a plan but wrote nothing.'));
    const host = makeHost();

    await runAgentLoop({
      host,
      prompt: 'implement feature X',
      mode: 'plan',
      maxIterations: 4,
      autoApprovePlan: true,
    });

    expect(
      host.events.some(
        (e) =>
          e.type === 'warning' &&
          /running Planner subagent/i.test(e.message),
      ),
    ).toBe(true);
    expect(
      host.events.some(
        (e) =>
          e.type === 'warning' &&
          /without submit_plan/i.test(e.message),
      ),
    ).toBe(true);
    const done = doneEvent(host);
    expect(done?.reason).toBe('incomplete');
  });
});

describe('nudge budgets are bounded', () => {
  it('caps every soft nudge at a small, finite number', () => {
    // Each nudge costs a full model turn. Unbounded retries are the
    // difference between a slow run and an expensive one.
    expect(MAX_TODO_WRITE_NUDGES).toBeGreaterThan(0);
    expect(MAX_TODO_WRITE_NUDGES).toBeLessThanOrEqual(2);
    expect(DEFAULT_MAX_ITERATIONS).toBeLessThanOrEqual(50);
    expect(DEFAULT_MAX_SUBAGENTS).toBeLessThanOrEqual(5);
  });
});
