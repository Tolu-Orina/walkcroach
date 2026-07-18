import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE_ID, getTemplate, TEMPLATES } from './index';

describe('TEMPLATES', () => {
  it('has expected template ids', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(ids).toContain('blank');
    expect(ids).toContain('landing-waitlist');
    expect(ids).toContain('saas-marketing');
    expect(ids).toContain('portfolio');
    expect(ids).toContain('internal-dashboard');
    expect(ids).toContain('todo');
    expect(ids).toContain('blog');
    expect(ids).toContain('pricing-faq');
    expect(ids).toContain('admin-crud');
  });

  it('each template buildTree produces src/App.tsx', () => {
    for (const t of TEMPLATES) {
      const tree = t.buildTree('test');
      const src = tree.src;
      expect(src).toBeDefined();
      expect('directory' in (src as object)).toBe(true);
      const dir = (src as { directory: Record<string, unknown> }).directory;
      expect(dir['App.tsx']).toBeDefined();
    }
  });

  it('each template has at least one example prompt', () => {
    for (const t of TEMPLATES) {
      expect(t.examplePrompts.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('DEFAULT_TEMPLATE_ID', () => {
  it('is blank', () => {
    expect(DEFAULT_TEMPLATE_ID).toBe('blank');
  });
});

describe('getTemplate', () => {
  it('returns matching template', () => {
    expect(getTemplate('todo').id).toBe('todo');
  });

  it('falls back to first template for unknown id', () => {
    expect(getTemplate('nonexistent').id).toBe(TEMPLATES[0].id);
  });

  it('falls back for null', () => {
    expect(getTemplate(null).id).toBe(TEMPLATES[0].id);
  });

  it('falls back for undefined', () => {
    expect(getTemplate(undefined).id).toBe(TEMPLATES[0].id);
  });
});
