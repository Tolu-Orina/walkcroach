/**
 * Harness security evals (P3.6) — CI pass/fail, not only golden coding tasks.
 *
 * Industry pattern (Codex / Claude Code harness lit): the harness must refuse
 * spoofed approvals, bound runaway tool loops, validate tool inputs, and honor
 * cancellation — model quality is secondary to these gates.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeHost } from '../fake-host.js';
import {
  ApprovalController,
  FleetApprovalRouter,
} from '../approval-controller.js';
import { executeTool } from '../tools/execute.js';
import { TelemetrySink } from '../telemetry.js';
import { scriptedConverse, resetEvalToolIds } from './harness.js';
import type { ApprovalRequest } from '../host.js';
import type { ProjectMemoryBridge } from '../project-memory.js';

const mockStreamConverseTurn = vi.fn();
const mockStreamPing = vi.fn();

vi.mock('../bedrock.js', () => ({
  getNovaModelId: () => 'test-model',
  getNovaReasoningEffort: () => 'medium',
  createBedrockClient: vi.fn(),
  streamConverseTurn: (...args: unknown[]) => mockStreamConverseTurn(...args),
  streamPing: (...args: unknown[]) => mockStreamPing(...args),
  DEFAULT_MAX_OUTPUT_TOKENS: 4096,
  DEFAULT_MAX_REASONING_OUTPUT_TOKENS: 30_000,
  DEFAULT_MAX_OUTPUT_CONTINUATIONS: 2,
  embedText: async () => [0.1, 0.2],
}));

import { runAgentLoop } from '../loop.js';

describe('eval security suite (P3.6)', () => {
  let workspace: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetEvalToolIds();
    workspace = await mkdtemp(join(tmpdir(), 'wc-sec-'));
    await mkdir(join(workspace, '.walkcroach'), { recursive: true });
  });

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it('injection: schema-invalid tool input never executes host I/O', async () => {
    const host = createFakeHost({
      autoApprove: true,
      workspaceRoot: workspace,
      files: { 'secret.ts': 'leak-me' },
    });
    const reads: string[] = [];
    const orig = host.readFile.bind(host);
    host.readFile = async (path) => {
      reads.push(path);
      return orig(path);
    };
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'inj-1',
        name: 'read_file',
        // Prompt-injection style: model omits path / uses empty
        input: { path: '' },
      },
      telemetry: new TelemetrySink(),
    });
    expect(result.status).toBe('error');
    expect(reads).toHaveLength(0);
  });

  it('tool-loop runaway: maxIterations bounds infinite tool_use', async () => {
    mockStreamConverseTurn.mockImplementation(
      scriptedConverse([
        {
          toolUses: [
            { name: 'list_dir', input: { path: '.' } },
          ],
        },
        {
          toolUses: [
            { name: 'list_dir', input: { path: '.' } },
          ],
        },
        {
          toolUses: [
            { name: 'list_dir', input: { path: '.' } },
          ],
        },
        {
          toolUses: [
            { name: 'list_dir', input: { path: '.' } },
          ],
        },
      ]),
    );

    const host = createFakeHost({
      autoApprove: true,
      workspaceRoot: workspace,
    });
    await runAgentLoop({
      host,
      prompt: 'loop forever',
      mode: 'full',
      includePhaseB: false,
      subagentsEnabled: false,
      maxIterations: 2,
    });
    const done = host.events.filter((e) => e.type === 'done');
    expect(done.length).toBeGreaterThan(0);
    expect(mockStreamConverseTurn.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('approval spoofing: fleet cannot cross-resolve another session', async () => {
    const router = new FleetApprovalRouter();
    const aReqs: ApprovalRequest[] = [];
    const gateA = new ApprovalController((r) => aReqs.push(r), {
      sessionId: 'sess-a',
    });
    const gateB = new ApprovalController(() => undefined, {
      sessionId: 'sess-b',
    });
    router.register('sess-a', gateA);
    router.register('sess-b', gateB);

    const pending = gateA.requestCommand({
      cmd: 'git push --force origin main',
      toolName: 'run_terminal',
    });
    const stepId = aReqs[0]!.stepId;

    // Attacker UI on session B.
    expect(router.resolveApproval(stepId, 'approve', 'sess-b')).toBe(true);
    // Still pending — correct session rejects.
    expect(router.resolveApproval(stepId, 'reject', 'sess-a')).toBe(true);
    await expect(pending).resolves.toBe('reject');
  });

  it('timeout: AbortSignal cancels pending approval (abandon)', async () => {
    const telemetry = new TelemetrySink();
    const gate = new ApprovalController(() => undefined, { telemetry });
    const ac = new AbortController();
    const pending = gate.requestCommand({
      cmd: 'sudo reboot',
      toolName: 'run_terminal',
      signal: ac.signal,
    });
    ac.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(telemetry.counters.approval_abandon).toBeGreaterThanOrEqual(1);
  });

  it('over-tooling: unknown tool name is refused by dispatch', async () => {
    const host = createFakeHost({ autoApprove: true, workspaceRoot: workspace });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'ot-1',
        name: 'exfiltrate_everything',
        input: { target: 'evil' },
      },
    });
    expect(result.status).toBe('error');
    expect(result.content).toMatch(/Unknown tool/);
  });

  it('memory tools use ProjectMemoryBridge only (P3.4)', async () => {
    const calls: string[] = [];
    const bridge: ProjectMemoryBridge = {
      projectId: 'proj-1',
      recall: async (q) => {
        calls.push(`recall:${q.query}`);
        return [
          {
            id: '1',
            kind: 'note',
            text: 'from-v1',
            sourceSurface: 'ide',
            distance: 0.1,
          },
        ];
      },
      mirror: async () => {
        calls.push('mirror');
        return { id: '3' };
      },
    };
    const host = createFakeHost({ autoApprove: true, workspaceRoot: workspace });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'mem-1',
        name: 'recall_project_memory',
        input: { query: 'auth patterns' },
      },
      projectMemory: bridge,
      telemetry: new TelemetrySink(),
    });
    expect(result.status).toBe('success');
    expect(result.content).toContain('from-v1');
    expect(calls).toEqual(['recall:auth patterns']);
  });
});
