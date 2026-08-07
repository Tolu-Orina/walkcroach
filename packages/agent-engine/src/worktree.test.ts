/**
 * D5.2 — enter_worktree / exit_worktree tool registration.
 */
import { describe, expect, it } from 'vitest';
import { toBedrockTools, getToolDef } from './tools/defs.js';
import { enterGitWorktree } from './worktree.js';

describe('D5.2 worktree tools', () => {
  it('registers enter_worktree and exit_worktree in Phase A tool list', () => {
    const tools = toBedrockTools({ includePhaseB: false, includePhaseC: false });
    const names = tools.map((t) => t.toolSpec?.name);
    expect(names).toContain('enter_worktree');
    expect(names).toContain('exit_worktree');
    expect(getToolDef('enter_worktree')?.inputSchema.required).toContain('branch_name');
    expect(getToolDef('exit_worktree')?.inputSchema.required).toContain('action');
  });

  it('sanitizes empty branch names', async () => {
    await expect(enterGitWorktree('/tmp', '   ')).rejects.toThrow(/empty/);
  });
});
