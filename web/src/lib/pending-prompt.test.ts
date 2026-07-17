import { describe, expect, it } from 'vitest';
import { inferTemplateFromPrompt, projectNameFromPrompt } from './pending-prompt';

describe('inferTemplateFromPrompt', () => {
  it('maps landing language to waitlist template', () => {
    expect(inferTemplateFromPrompt('Build a landing page with email capture')).toBe(
      'landing-waitlist',
    );
  });

  it('maps todo language to todo template', () => {
    expect(inferTemplateFromPrompt('Simple todo app with filters')).toBe('todo');
  });

  it('falls back to blank', () => {
    expect(inferTemplateFromPrompt('Something completely custom')).toBe('blank');
  });
});

describe('projectNameFromPrompt', () => {
  it('truncates long prompts', () => {
    const long = 'a'.repeat(60);
    expect(projectNameFromPrompt(long)).toHaveLength(46);
    expect(projectNameFromPrompt(long).endsWith('…')).toBe(true);
  });
});
