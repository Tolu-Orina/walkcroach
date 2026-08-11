import { describe, expect, it } from 'vitest';
import {
  createReadFreshnessTracker,
  evaluateMutationFreshness,
  formatEditMismatchError,
  hashFileContent,
  recordReadFreshness,
} from './read-freshness.js';
import { executeTool } from './tools/execute.js';
import { createFakeHost } from './fake-host.js';

describe('content-aware freshness', () => {
  it('allows when hash matches despite mtime bump (autosave false positive)', () => {
    const t = createReadFreshnessTracker(50);
    const content = 'const x = 1;\n';
    recordReadFreshness(t, '/a.ts', { content, mtimeMs: 1000 });
    const check = evaluateMutationFreshness({
      tracker: t,
      path: '/a.ts',
      currentContent: content,
      currentMtimeMs: 9000,
      kind: 'write_file',
    });
    expect(check.ok).toBe(true);
  });

  it('allows edit when content changed but old_str still unique', () => {
    const t = createReadFreshnessTracker();
    recordReadFreshness(t, '/a.ts', {
      content: 'line1\nold\nline3\n',
      mtimeMs: 1,
    });
    const current = 'line1\nold\nline3\n// footer\n';
    const check = evaluateMutationFreshness({
      tracker: t,
      path: '/a.ts',
      currentContent: current,
      currentMtimeMs: 2,
      kind: 'edit_file',
      oldStr: 'old',
    });
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.note).toMatch(/changed externally/i);
  });

  it('rejects write_file when content hash changed', () => {
    const t = createReadFreshnessTracker();
    recordReadFreshness(t, '/a.ts', { content: 'one', mtimeMs: 1 });
    const check = evaluateMutationFreshness({
      tracker: t,
      path: '/a.ts',
      currentContent: 'two',
      currentMtimeMs: 2,
      kind: 'write_file',
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.message).toMatch(/\[stale_read\]/);
      expect(check.message).toMatch(/--- current contents/);
      expect(check.message).toMatch(/3–5 lines/);
      expect(check.message).toContain('two');
    }
  });

  it('rejects edit when old_str missing after content change', () => {
    const t = createReadFreshnessTracker();
    recordReadFreshness(t, '/a.ts', { content: 'alpha', mtimeMs: 1 });
    const check = evaluateMutationFreshness({
      tracker: t,
      path: '/a.ts',
      currentContent: 'beta',
      kind: 'edit_file',
      oldStr: 'alpha',
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.message).toMatch(/\[stale_read\]/);
      expect(check.message).toContain('beta');
    }
  });

  it('formatEditMismatchError includes excerpt + no-retry hint', () => {
    const msg = formatEditMismatchError({
      path: '/a.ts',
      reason: 'old_str not found in /a.ts',
      content: 'hello world',
    });
    expect(msg).toMatch(/\[edit_mismatch\]/);
    expect(msg).toMatch(/Do not retry the identical old_str/);
    expect(msg).toMatch(/Do not switch edit_file/);
    expect(msg).not.toMatch(/Prefer apply_patch/);
    expect(msg).toContain('hello world');
  });

  it('updates tracker hash after reject so next check uses current bytes', async () => {
    const host = createFakeHost({
      autoApprove: true,
      files: { '/workspace/a.ts': 'one' },
    });
    let mtime = 1000;
    host.supportsMtimeFreshness = true;
    host.getFileMtimeMs = async () => mtime;

    const tracker = createReadFreshnessTracker(50);
    await executeTool({
      host,
      tool: {
        toolUseId: 'r1',
        name: 'read_file',
        input: { path: '/workspace/a.ts' },
      },
      readFreshness: tracker,
    });

    host.files.set('/workspace/a.ts', 'changed-externally');
    mtime = 5000;

    const rejected = await executeTool({
      host,
      tool: {
        toolUseId: 'w1',
        name: 'write_file',
        input: { path: '/workspace/a.ts', content: 'overwrite' },
      },
      readFreshness: tracker,
    });
    expect(rejected.status).toBe('error');
    expect(rejected.content).toMatch(/\[stale_read\]/);

    const snap = tracker.lastRead.get('/workspace/a.ts');
    expect(snap?.contentHash).toBe(hashFileContent('changed-externally'));

    // Same content now tracked — write allowed without another read.
    const ok = await executeTool({
      host,
      tool: {
        toolUseId: 'w2',
        name: 'write_file',
        input: { path: '/workspace/a.ts', content: 'overwrite' },
      },
      readFreshness: tracker,
    });
    expect(ok.status).toBe('success');
  });

  it('allows write when only mtime drifts (content unchanged) via executeTool', async () => {
    const host = createFakeHost({
      autoApprove: true,
      files: { '/workspace/a.ts': 'stable' },
    });
    let mtime = 1000;
    host.supportsMtimeFreshness = true;
    host.getFileMtimeMs = async () => mtime;

    const tracker = createReadFreshnessTracker(50);
    await executeTool({
      host,
      tool: {
        toolUseId: 'r1',
        name: 'read_file',
        input: { path: '/workspace/a.ts' },
      },
      readFreshness: tracker,
    });
    mtime = 99999;
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'w1',
        name: 'write_file',
        input: { path: '/workspace/a.ts', content: 'next' },
      },
      readFreshness: tracker,
    });
    expect(result.status).toBe('success');
  });
});
