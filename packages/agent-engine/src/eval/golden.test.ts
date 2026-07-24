/**
 * Golden eval tasks: scaffold → fix → verify gate.
 * Regression gate for loop quality (P2).
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeHost } from '../fake-host.js';
import { scriptedConverse, resetEvalToolIds } from './harness.js';

const mockStreamConverseTurn = vi.fn();
const mockStreamPing = vi.fn();

vi.mock('../bedrock.js', () => ({
  getNovaModelId: () => 'test-model',
  createBedrockClient: vi.fn(),
  streamConverseTurn: (...args: unknown[]) => mockStreamConverseTurn(...args),
  streamPing: (...args: unknown[]) => mockStreamPing(...args),
  DEFAULT_MAX_OUTPUT_TOKENS: 4096,
  DEFAULT_MAX_OUTPUT_CONTINUATIONS: 2,
}));

import { runAgentLoop } from '../loop.js';

describe('eval golden tasks', () => {
  let workspace: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetEvalToolIds();
    workspace = await mkdtemp(join(tmpdir(), 'wc-eval-'));
    await mkdir(join(workspace, '.walkcroach'), { recursive: true });
  });

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it('scaffold-write: creates a file via write_file then ends', async () => {
    mockStreamConverseTurn.mockImplementation(
      scriptedConverse([
        {
          toolUses: [
            {
              name: 'write_file',
              input: {
                path: 'hello.ts',
                content: 'export const hello = "world";\n',
              },
            },
          ],
        },
        // Parent end → soft todo nudge
        { text: 'Created hello.ts', stopReason: 'end_turn' },
        // Parent end → verify-review subagent consumes REVIEW_OK
        { text: 'REVIEW_OK\nLooks good.', stopReason: 'end_turn' },
      ]),
    );

    const host = createFakeHost({
      autoApprove: true,
      workspaceRoot: workspace,
      files: {},
    });

    await runAgentLoop({
      host,
      prompt: 'create hello.ts',
      mode: 'full',
      actionBias: 'always',
      includePhaseB: false,
      subagentsEnabled: false,
      maxIterations: 8,
    });

    expect(host.files.get('hello.ts')).toContain('hello');
    const done = host.events.find((e) => e.type === 'done');
    expect(done && done.type === 'done' ? done.reason : '').toBe('end_turn');
  });

  it('fix-edit: apply_patch updates an existing file', async () => {
    mockStreamConverseTurn.mockImplementation(
      scriptedConverse([
        {
          toolUses: [
            {
              name: 'apply_patch',
              input: {
                path: 'bug.ts',
                edits: [
                  {
                    old_str: 'return a - b;',
                    new_str: 'return a + b;',
                  },
                ],
              },
            },
          ],
        },
        { text: 'Fixed add()', stopReason: 'end_turn' },
        { text: 'REVIEW_OK\nFixed.', stopReason: 'end_turn' },
      ]),
    );

    const host = createFakeHost({
      autoApprove: true,
      workspaceRoot: workspace,
      files: {
        'bug.ts':
          'export function add(a: number, b: number) {\n  return a - b;\n}\n',
      },
    });

    await runAgentLoop({
      host,
      prompt: 'fix the add function',
      mode: 'full',
      actionBias: 'always',
      includePhaseB: false,
      subagentsEnabled: false,
      maxIterations: 8,
    });

    expect(host.files.get('bug.ts')).toContain('return a + b;');
  });

  it('verify-gate: mutating work without verify ends unverified when required', async () => {
    await writeFile(
      join(workspace, '.walkcroach', 'verify.json'),
      JSON.stringify({ commands: ['npm test'], cwd: '.' }),
      'utf8',
    );
    await writeFile(
      join(workspace, '.walkcroach', 'settings.json'),
      JSON.stringify({
        verify: { required: true, maxNudges: 0 },
      }),
      'utf8',
    );

    // Soft nudges = 0 + HARD_VERIFY_EXTRA (3) = 3 verify nudges, then unverified.
    // Script: write once, then keep ending so verify gate fires.
    const endTurn = () => ({
      text: 'All done!',
      stopReason: 'end_turn' as const,
    });
    mockStreamConverseTurn.mockImplementation(
      scriptedConverse([
        {
          toolUses: [
            {
              name: 'write_file',
              input: { path: 'x.ts', content: 'export {};\n' },
            },
          ],
        },
        endTurn(),
        endTurn(),
        endTurn(),
        endTurn(),
        endTurn(),
      ]),
    );

    const host = createFakeHost({
      autoApprove: true,
      workspaceRoot: workspace,
      files: {},
    });

    await runAgentLoop({
      host,
      prompt: 'add x.ts',
      mode: 'full',
      actionBias: 'always',
      includePhaseB: false,
      subagentsEnabled: false,
      maxIterations: 12,
    });

    const done = host.events.find((e) => e.type === 'done');
    expect(done && done.type === 'done' ? done.reason : '').toBe('unverified');
    expect(done && done.type === 'done' ? done.canContinue : false).toBe(true);
  });
});
