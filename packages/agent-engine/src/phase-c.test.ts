import { describe, expect, it } from 'vitest';
import { normalizeLocalRepoKey } from './repo-key.js';
import { PHASE_C_TOOLS, toBedrockTools } from './tools/defs.js';
import { shouldAutoApprove } from './approvals.js';

describe('Phase C repo key', () => {
  it('matches BFF normalization', () => {
    expect(
      normalizeLocalRepoKey({ gitRemoteUrl: 'git@github.com:Acme/App.git' }),
    ).toBe('git:https://github.com/acme/app');
  });
});

describe('Phase C tools', () => {
  it('includes recall and mirror only when includePhaseC', () => {
    const without = toBedrockTools({ includePhaseC: false });
    expect(
      without.some((t) => t.toolSpec?.name === 'recall_project_memory'),
    ).toBe(false);
    const withC = toBedrockTools({ includePhaseC: true });
    expect(
      withC.some((t) => t.toolSpec?.name === 'recall_project_memory'),
    ).toBe(true);
    expect(
      withC.some((t) => t.toolSpec?.name === 'mirror_project_memory'),
    ).toBe(true);
    expect(PHASE_C_TOOLS).toHaveLength(2);
  });

  it('never auto-approves mirror under low_friction', () => {
    expect(
      shouldAutoApprove({
        autonomy: 'low_friction',
        toolName: 'mirror_project_memory',
        input: { text: 'prefer uuid pks' },
      }),
    ).toBe(false);
  });
});
