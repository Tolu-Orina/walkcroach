import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumePendingPrompt,
  inferTemplateFromPrompt,
  PENDING_PROMPT_KEY,
  peekPendingPrompt,
  projectNameFromPrompt,
  setPendingPrompt,
} from './pending-prompt';

const fakeSession: Record<string, string> = {};

beforeEach(() => {
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn((k: string) => fakeSession[k] ?? null),
    setItem: vi.fn((k: string, v: string) => {
      fakeSession[k] = v;
    }),
    removeItem: vi.fn((k: string) => {
      delete fakeSession[k];
    }),
  });
});

afterEach(() => {
  for (const k of Object.keys(fakeSession)) delete fakeSession[k];
  vi.restoreAllMocks();
});

describe('inferTemplateFromPrompt', () => {
  it.each([
    ['Build a landing page with email capture', 'landing-waitlist'],
    ['Join the waitlist now', 'landing-waitlist'],
    ['Launch page for beta', 'landing-waitlist'],
    ['SaaS marketing homepage', 'saas-marketing'],
    ['Trial signup product page', 'saas-marketing'],
    ['My portfolio with case study', 'portfolio'],
    ['Personal site for designer', 'portfolio'],
    ['Dashboard for analytics', 'internal-dashboard'],
    ['Ops metrics overview', 'internal-dashboard'],
    ['Simple todo app with filters', 'todo'],
    ['Task list manager', 'todo'],
    ['Blog with article summaries', 'blog'],
    ['Post list layout', 'blog'],
    ['Pricing comparison table', 'pricing-faq'],
    ['FAQ section', 'pricing-faq'],
    ['Admin table CRUD for accounts', 'admin-crud'],
    ['CRUD app for accounts', 'admin-crud'],
  ])('maps "%s" → %s', (prompt, expected) => {
    expect(inferTemplateFromPrompt(prompt)).toBe(expected);
  });

  it('falls back to blank', () => {
    expect(inferTemplateFromPrompt('Something completely custom')).toBe('blank');
  });
});

describe('projectNameFromPrompt', () => {
  it('returns short prompts as-is', () => {
    expect(projectNameFromPrompt('My app')).toBe('My app');
  });

  it('truncates long prompts to 46 chars with ellipsis', () => {
    const long = 'a'.repeat(60);
    const result = projectNameFromPrompt(long);
    expect(result).toHaveLength(46);
    expect(result.endsWith('…')).toBe(true);
  });

  it('trims whitespace', () => {
    expect(projectNameFromPrompt('  hello  ')).toBe('hello');
  });
});

describe('setPendingPrompt', () => {
  it('stores prompt with inferred template', () => {
    setPendingPrompt('Build a todo app');
    expect(sessionStorage.setItem).toHaveBeenCalledWith(
      PENDING_PROMPT_KEY,
      expect.stringContaining('"todo"'),
    );
  });

  it('stores prompt with explicit template', () => {
    setPendingPrompt('Hello', 'blog');
    const written = (sessionStorage.setItem as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(JSON.parse(written).templateId).toBe('blog');
  });

  it('skips empty prompts', () => {
    setPendingPrompt('   ');
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('peekPendingPrompt', () => {
  it('returns null when nothing stored', () => {
    expect(peekPendingPrompt()).toBeNull();
  });

  it('returns parsed prompt', () => {
    fakeSession[PENDING_PROMPT_KEY] = JSON.stringify({
      prompt: 'Test',
      templateId: 'blog',
    });
    expect(peekPendingPrompt()).toEqual({ prompt: 'Test', templateId: 'blog' });
  });

  it('returns null on invalid JSON', () => {
    fakeSession[PENDING_PROMPT_KEY] = '{bad}';
    expect(peekPendingPrompt()).toBeNull();
  });

  it('returns null when prompt is empty string', () => {
    fakeSession[PENDING_PROMPT_KEY] = JSON.stringify({
      prompt: '  ',
      templateId: 'x',
    });
    expect(peekPendingPrompt()).toBeNull();
  });

  it('defaults templateId to blank when missing', () => {
    fakeSession[PENDING_PROMPT_KEY] = JSON.stringify({
      prompt: 'Hello',
      templateId: '',
    });
    expect(peekPendingPrompt()!.templateId).toBe('blank');
  });
});

describe('consumePendingPrompt', () => {
  it('returns and removes the pending prompt', () => {
    fakeSession[PENDING_PROMPT_KEY] = JSON.stringify({
      prompt: 'Go',
      templateId: 'todo',
    });
    const result = consumePendingPrompt();
    expect(result).toEqual({ prompt: 'Go', templateId: 'todo' });
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(PENDING_PROMPT_KEY);
  });

  it('returns null and does not remove when nothing stored', () => {
    expect(consumePendingPrompt()).toBeNull();
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
  });
});
