import { describe, expect, it, vi, afterEach } from 'vitest';
import { deriveTitle, renderPrBody, type AgentRunner } from './content-publish.js';

afterEach(() => vi.unstubAllGlobals());

describe('deriveTitle', () => {
  it('prefers an explicit title', () => {
    expect(deriveTitle({ kind: 'md', text: '# Other', title: 'Chosen' } as never)).toBe('Chosen');
  });

  it('falls back to the first H1', () => {
    expect(deriveTitle({ kind: 'markdown', text: 'intro\n\n# Real title\n\nbody' })).toBe(
      'Real title',
    );
  });

  it('falls back to a tidied filename', () => {
    expect(deriveTitle({ kind: 'docx', text: 'no heading', filename: 'our_big-launch.docx' })).toBe(
      'our big launch',
    );
  });

  it('never returns empty', () => {
    expect(deriveTitle({ kind: 'pdf', text: '' })).toBe('New post');
  });
});

describe('renderPrBody', () => {
  const base = {
    title: 'Launch',
    source: { kind: 'docx' as const, text: '', filename: 'launch.docx' },
    files: ['src/content/blog/launch.tsx'],
    style: [
      { key: 'import.alias', value: '@/', source: 'repo' as const, because: 'tsconfig.json' },
      { key: 'heading.case', value: 'sentence', source: 'memory' as const, because: 'confirmed' },
    ],
    signals: [],
    flags: [],
    refusals: [],
  };

  it('lists the files added and where each convention came from', () => {
    const body = renderPrBody(base);
    expect(body).toMatch(/src\/content\/blog\/launch\.tsx/);
    expect(body).toMatch(/`import\.alias`: @\/ — _tsconfig\.json_/);
    expect(body).toMatch(/launch\.docx/);
  });

  it('states plainly that nothing existing was modified', () => {
    // The reviewer's first question about an agent-authored PR.
    expect(renderPrBody(base)).toMatch(/adds files only; no existing file was modified/);
  });

  it('surfaces refusals rather than hiding them', () => {
    // A refusal often explains why the result is narrower than expected.
    const body = renderPrBody({
      ...base,
      refusals: [
        { rule: 'write-scope', reason: 'x', subject: 'src/components/Button.tsx' },
      ],
    });
    expect(body).toMatch(/Actions refused/);
    expect(body).toMatch(/src\/components\/Button\.tsx/);
  });

  it('includes security notes when anything was flagged', () => {
    const body = renderPrBody({
      ...base,
      signals: [{ pattern: 'instruction-override', excerpt: 'ignore all previous' }],
      flags: [{ rule: 'inline-script', path: 'src/a.tsx', excerpt: '<script>' }],
    });
    expect(body).toMatch(/security notes/i);
    expect(body).toMatch(/instruction-override/);
    expect(body).toMatch(/heuristics, not proof/i);
  });

  it('omits the security section entirely when clean', () => {
    expect(renderPrBody(base)).not.toMatch(/security notes/i);
  });

  it('orders conventions deterministically', () => {
    const a = renderPrBody(base);
    const b = renderPrBody({ ...base, style: [...base.style].reverse() });
    expect(a).toBe(b);
  });
});

describe('AgentRunner contract', () => {
  it('is satisfied by a function returning the documented shape', async () => {
    // The run is injected so this pipeline is testable without a model, a
    // sandbox, or a network. This asserts the seam holds.
    const runner: AgentRunner = async ({ files, workspaceRoot, prompt, context }) => {
      expect(workspaceRoot).toBe('/workspace');
      expect(typeof prompt).toBe('string');
      expect(typeof context).toBe('string');
      return {
        ok: true,
        reason: 'completed',
        filesWritten: ['src/content/blog/post.tsx'],
        snapshot: {
          ...files,
          '/workspace/src/content/blog/post.tsx': 'export default () => null;',
        },
        refusals: [],
      };
    };

    const result = await runner({
      files: { '/workspace/package.json': '{}' },
      workspaceRoot: '/workspace',
      prompt: 'p',
      context: 'c',
    });
    expect(result.filesWritten).toEqual(['src/content/blog/post.tsx']);
    expect(result.snapshot['/workspace/package.json']).toBe('{}');
  });
});
