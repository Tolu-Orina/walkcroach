import { describe, expect, it } from 'vitest';
import { canNonInteractiveApprove } from '@walkcroach/agent-engine';
import { resolveOutputMode } from './lib/output.js';

describe('canNonInteractiveApprove (FR-D25)', () => {
  it('allows safe local file edits', () => {
    expect(
      canNonInteractiveApprove({
        toolName: 'edit_file',
        input: { path: 'src/a.ts', old_str: 'x', new_str: 'y' },
      }),
    ).toBe(true);
    expect(
      canNonInteractiveApprove({
        toolName: 'write_file',
        input: { path: 'src/b.ts' },
      }),
    ).toBe(true);
  });

  it('refuses infra, ccloud, mcp, sensitive paths', () => {
    expect(
      canNonInteractiveApprove({
        toolName: 'ccloud',
        input: { args: ['cluster', 'create'] },
        cmdPreview: 'ccloud cluster create',
      }),
    ).toBe(false);
    expect(
      canNonInteractiveApprove({
        toolName: 'cockroach_mcp',
        input: {},
        cmdPreview: 'MCP WRITE: insert_row',
      }),
    ).toBe(false);
    expect(
      canNonInteractiveApprove({
        toolName: 'run_terminal',
        input: { cmd: 'ccloud cluster create' },
        cmdPreview: 'ccloud cluster create',
      }),
    ).toBe(false);
    expect(
      canNonInteractiveApprove({
        toolName: 'write_file',
        input: { path: '.env' },
      }),
    ).toBe(false);
  });

  it('denies all terminal in CI (shell deny-by-default)', () => {
    expect(
      canNonInteractiveApprove({
        toolName: 'run_terminal',
        input: { cmd: 'npm test' },
        cmdPreview: 'npm test',
      }),
    ).toBe(false);
  });
});

describe('resolveOutputMode', () => {
  it('json wins', () => {
    expect(resolveOutputMode({ json: true, forceTui: true })).toBe('json');
  });

  it('noTui forces text', () => {
    expect(resolveOutputMode({ noTui: true })).toBe('text');
  });
});
