/**
 * P3.1 / P3.5 — dispatch validation + structured telemetry / SLIs.
 */
import { describe, expect, it } from 'vitest';
import { validateToolInput } from './dispatch.js';
import { AGENT_SLIS, TelemetrySink } from '../telemetry.js';
import { createFakeHost } from '../fake-host.js';
import { executeTool } from './execute.js';

describe('tool dispatch validation (P3.1)', () => {
  it('rejects unknown tools', () => {
    expect(validateToolInput('not_a_real_tool', {})).toMatchObject({
      ok: false,
    });
  });

  it('rejects missing required fields', () => {
    expect(validateToolInput('read_file', {})).toMatchObject({ ok: false });
    expect(validateToolInput('read_file', { path: '' })).toMatchObject({
      ok: false,
    });
    expect(validateToolInput('read_file', { path: 'a.ts' })).toEqual({
      ok: true,
    });
  });

  it('executeTool short-circuits invalid input with observe', async () => {
    const host = createFakeHost({ autoApprove: true });
    const telemetry = new TelemetrySink();
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 't1',
        name: 'read_file',
        input: {},
      },
      telemetry,
    });
    expect(result.status).toBe('error');
    expect(result.content).toMatch(/requires/);
    expect(telemetry.counters.tool_dispatch).toBe(1);
    expect(telemetry.counters.tool_error).toBe(1);
    expect(telemetry.events.some((e) => e.name === 'gen_ai.tool.call')).toBe(
      true,
    );
  });
});

describe('telemetry SLIs (P3.5)', () => {
  it('defines exit-criteria SLI names', () => {
    expect(AGENT_SLIS.MEMORY_RECALL_P95_MS).toContain('memory_recall');
    expect(AGENT_SLIS.TOOL_ERROR_RATE).toContain('tool_error');
    expect(AGENT_SLIS.APPROVAL_ABANDON_RATE).toContain('approval_abandon');
  });

  it('computes rates and EMF payload', () => {
    const t = new TelemetrySink();
    t.recordTool({ name: 'read_file', status: 'success', latencyMs: 10 });
    t.recordTool({ name: 'read_file', status: 'error', latencyMs: 20 });
    t.recordTool({
      name: 'recall_project_memory',
      status: 'success',
      latencyMs: 50,
    });
    t.recordApprovalWait({ kind: 'command', outcome: 'waiting' });
    t.recordApprovalWait({ kind: 'command', outcome: 'abandoned', waitMs: 1 });
    expect(t.toolErrorRate()).toBeCloseTo(1 / 3);
    expect(t.approvalAbandonRate()).toBeCloseTo(1);
    expect(t.memoryRecallP95Ms()).toBe(50);
    const emf = t.toEmf();
    expect(emf.ToolDispatch).toBe(3);
    expect(emf.sli).toEqual(AGENT_SLIS);
  });
});
