import { describe, expect, it } from 'vitest';
import {
  getToolDef,
  getToolKind,
  resolveToolProfile,
  toBedrockTools,
  toolAwaitResult,
} from './tools.js';

describe('tools', () => {
  it('classifies client_resume tools', () => {
    expect(getToolKind('run_terminal')).toBe('client_resume');
    expect(toolAwaitResult('run_terminal')).toBe(true);
  });

  it('classifies server tools', () => {
    expect(getToolKind('remember_preference')).toBe('server');
    expect(getToolKind('web_search')).toBe('server');
    expect(toolAwaitResult('remember_preference')).toBe(false);
  });

  it('exposes write_file / edit_file as client_resume', () => {
    expect(getToolDef('write_file')?.kind).toBe('client_resume');
    expect(getToolKind('write_file')).toBe('client_resume');
    expect(toolAwaitResult('write_file')).toBe(true);
    expect(getToolKind('edit_file')).toBe('client_resume');
    expect(toolAwaitResult('edit_file')).toBe(true);
  });

  it('maps legacy build/plan modes to profiles', () => {
    expect(resolveToolProfile('build')).toBe('builder');
    expect(resolveToolProfile('plan')).toBe('plan');
    expect(resolveToolProfile('chat')).toBe('chat');
  });

  it('limits plan mode to server tools only', () => {
    const plan = toBedrockTools('plan');
    const names = plan.map((t) => t.toolSpec.name);
    expect(names).toContain('remember_preference');
    expect(names).toContain('web_search');
    expect(names).not.toContain('write_file');
  });

  it('chat profile excludes builder file/terminal tools', () => {
    const chat = toBedrockTools('chat');
    const names = chat.map((t) => t.toolSpec.name);
    expect(names).toContain('web_search');
    expect(names).toContain('web_extract');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('run_terminal');
  });

  it('includes write tools in build/builder mode', () => {
    const build = toBedrockTools('build');
    const names = build.map((t) => t.toolSpec.name);
    expect(names).toContain('write_file');
    expect(names).toContain('run_terminal');
    expect(names).toContain('web_search');
  });
});
