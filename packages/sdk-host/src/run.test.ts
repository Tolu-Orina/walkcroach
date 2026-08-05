import { describe, expect, it } from 'vitest';
import { buildPrompt } from './run.js';

describe('buildPrompt', () => {
  it('states the workspace rule before the task', () => {
    // A model that learns the constraint by being refused mid-run burns
    // iterations rediscovering it, and may conclude the task is impossible.
    const p = buildPrompt({
      prompt: 'Add a blog post page for the launch article.',
      writeScope: { mode: 'additive' },
    });
    expect(p.indexOf('Workspace rules')).toBeLessThan(p.indexOf('## Task'));
    expect(p).toMatch(/must NOT modify or delete/);
  });

  it('names the writable paths in scoped mode', () => {
    const p = buildPrompt({
      prompt: 'x',
      writeScope: { mode: 'scoped', allow: ['src/content/blog'] },
    });
    expect(p).toMatch(/src\/content\/blog/);
  });

  it('includes context between the rules and the task', () => {
    const p = buildPrompt({
      prompt: 'Write the page',
      writeScope: { mode: 'additive' },
      context: 'house style: heading.case = sentence',
    });
    expect(p.indexOf('## Context')).toBeLessThan(p.indexOf('## Task'));
    expect(p).toMatch(/heading\.case/);
  });

  it('omits the context section entirely when there is none', () => {
    const p = buildPrompt({ prompt: 'x', writeScope: { mode: 'full' } });
    expect(p).not.toMatch(/## Context/);
  });

  it('does not weaken the rule for full mode', () => {
    const p = buildPrompt({ prompt: 'x', writeScope: { mode: 'full' } });
    expect(p).toMatch(/create, modify, and delete/);
  });
});
