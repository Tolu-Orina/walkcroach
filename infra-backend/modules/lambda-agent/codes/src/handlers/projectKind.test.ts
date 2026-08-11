import { describe, expect, it } from 'vitest';
import {
  parseListProjectsKindFilter,
  resolveCreateProjectKind,
  resolveCreateTemplateId,
  resolvePatchTemplateId,
} from './projectKind.js';

describe('resolveCreateProjectKind', () => {
  it('defaults omitted to app', () => {
    expect(resolveCreateProjectKind(undefined)).toEqual({
      ok: true,
      value: 'app',
    });
    expect(resolveCreateProjectKind(null)).toEqual({ ok: true, value: 'app' });
    expect(resolveCreateProjectKind('')).toEqual({ ok: true, value: 'app' });
  });

  it('accepts app and knowledge', () => {
    expect(resolveCreateProjectKind('app')).toEqual({
      ok: true,
      value: 'app',
    });
    expect(resolveCreateProjectKind('knowledge')).toEqual({
      ok: true,
      value: 'knowledge',
    });
  });

  it('rejects general and unknown', () => {
    expect(resolveCreateProjectKind('general').ok).toBe(false);
    expect(resolveCreateProjectKind('workspace').ok).toBe(false);
  });
});

describe('resolveCreateTemplateId', () => {
  it('forces null for knowledge regardless of templateId', () => {
    expect(resolveCreateTemplateId('knowledge', 'blank')).toBeNull();
    expect(resolveCreateTemplateId('knowledge', undefined)).toBeNull();
  });

  it('defaults blank for app when omitted', () => {
    expect(resolveCreateTemplateId('app', undefined)).toBe('blank');
    expect(resolveCreateTemplateId('app', '')).toBe('blank');
  });

  it('keeps explicit app template', () => {
    expect(resolveCreateTemplateId('app', 'saas')).toBe('saas');
  });
});

describe('parseListProjectsKindFilter', () => {
  it('omitted → null (all non-general)', () => {
    expect(parseListProjectsKindFilter(undefined)).toEqual({
      ok: true,
      value: null,
    });
    expect(parseListProjectsKindFilter('')).toEqual({
      ok: true,
      value: null,
    });
  });

  it('accepts app and knowledge', () => {
    expect(parseListProjectsKindFilter('knowledge')).toEqual({
      ok: true,
      value: 'knowledge',
    });
    expect(parseListProjectsKindFilter('app')).toEqual({
      ok: true,
      value: 'app',
    });
  });

  it('rejects general and garbage', () => {
    expect(parseListProjectsKindFilter('general').ok).toBe(false);
    expect(parseListProjectsKindFilter('foo').ok).toBe(false);
  });
});

describe('resolvePatchTemplateId', () => {
  it('clears template on knowledge rows', () => {
    expect(
      resolvePatchTemplateId({
        kind: 'knowledge',
        bodyTemplateId: 'blank',
        currentTemplateId: 'blank',
      }),
    ).toBeNull();
  });

  it('updates template on app rows when provided', () => {
    expect(
      resolvePatchTemplateId({
        kind: 'app',
        bodyTemplateId: 'todo',
        currentTemplateId: 'blank',
      }),
    ).toBe('todo');
  });

  it('keeps current when body omits templateId', () => {
    expect(
      resolvePatchTemplateId({
        kind: 'app',
        bodyTemplateId: undefined,
        currentTemplateId: 'blank',
      }),
    ).toBe('blank');
  });
});
