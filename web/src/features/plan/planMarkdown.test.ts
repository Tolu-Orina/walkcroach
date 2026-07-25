import { describe, expect, it } from 'vitest';
import {
  formatEditedPlanAdjustment,
  formatPlanMarkdown,
  planFilesEqual,
} from './planMarkdown';

describe('formatPlanMarkdown', () => {
  it('writes durable plan.md content', () => {
    const md = formatPlanMarkdown('plan-1', [
      { path: 'src/App.tsx', reason: 'create or replace file', preview: 'export default…' },
    ]);
    expect(md).toContain('# WalkCroach plan');
    expect(md).toContain('plan-1');
    expect(md).toContain('src/App.tsx');
    expect(md).toContain('export default…');
  });
});

describe('planFilesEqual', () => {
  it('detects edits', () => {
    const a = [{ path: 'a.ts', reason: 'x' }];
    const b = [{ path: 'a.ts', reason: 'y' }];
    expect(planFilesEqual(a, a)).toBe(true);
    expect(planFilesEqual(a, b)).toBe(false);
  });
});

describe('formatEditedPlanAdjustment', () => {
  it('lists keep and omit paths', () => {
    const text = formatEditedPlanAdjustment(
      [
        { path: 'a.ts', reason: 'create' },
        { path: 'b.ts', reason: 'edit' },
      ],
      [{ path: 'a.ts', reason: 'create homepage' }],
    );
    expect(text).toContain('Keep:');
    expect(text).toContain('a.ts: create homepage');
    expect(text).toContain('Omit');
    expect(text).toContain('b.ts');
  });
});
