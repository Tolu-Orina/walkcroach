import { describe, expect, it } from 'vitest';
import { getToolDef, getToolKind, toBedrockTools, toolAwaitResult } from './tools.js';

describe('tools', () => {
  it('classifies client_resume tools', () => {
    expect(getToolKind('run_terminal')).toBe('client_resume');
    expect(toolAwaitResult('run_terminal')).toBe(true);
  });

  it('classifies server tools', () => {
    expect(getToolKind('remember_preference')).toBe('server');
    expect(toolAwaitResult('remember_preference')).toBe(false);
  });

  it('exposes write_file as client_local', () => {
    expect(getToolDef('write_file')?.kind).toBe('client_local');
    expect(getToolKind('write_file')).toBe('client_local');
  });

  it('limits plan mode to server tools only', () => {
    const plan = toBedrockTools('plan');
    const names = plan.map((t) => t.toolSpec.name);
    expect(names).toContain('remember_preference');
    expect(names).not.toContain('write_file');
  });

  it('includes write tools in build mode', () => {
    const build = toBedrockTools('build');
    const names = build.map((t) => t.toolSpec.name);
    expect(names).toContain('write_file');
    expect(names).toContain('run_terminal');
  });
});
