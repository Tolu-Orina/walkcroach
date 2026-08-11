import { describe, expect, it } from 'vitest';
import type { Message } from '@aws-sdk/client-bedrock-runtime';
import {
  compactSessionMessages,
  DEFAULT_COMPACT_THRESHOLD,
  summarizeDroppedMessages,
} from './compact.js';
import {
  applyDiffString,
  applyPatchEdits,
  normalizePatchEdits,
} from './patch.js';
import {
  looksLikeActionTask,
  shouldTreatAsActionTask,
  buildUserTurn,
} from './prompt.js';
import {
  isReviewOk,
  PARALLEL_SAFE_TOOLS,
  REVIEW_OK_MARKER,
} from './loop.js';
import {
  isLowFrictionPatchEligible,
  shouldAutoApprove,
} from './approvals.js';
import { createFakeHost } from './fake-host.js';
import { executeTool } from './tools/execute.js';
import { getToolDef } from './tools/defs.js';
import { createEditAnchorFailCache } from './edit-anchor-guard.js';
import { createEditPathMismatchState } from './edit-path-mismatch-guard.js';

describe('P1 compact', () => {
  it('does not compact under threshold', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ text: 'task' }] },
      { role: 'assistant', content: [{ text: 'ok' }] },
    ];
    const out = compactSessionMessages(messages);
    expect(out.compacted).toBe(false);
    expect(out.messages).toBe(messages);
  });

  it('summarizes dropped middle and keeps first + recent', () => {
    const messages: Message[] = [];
    messages.push({ role: 'user', content: [{ text: 'scaffold app' }] });
    for (let i = 0; i < DEFAULT_COMPACT_THRESHOLD + 4; i++) {
      messages.push({
        role: 'assistant',
        content: [
          {
            toolUse: {
              toolUseId: `t${i}`,
              name: i % 2 === 0 ? 'read_file' : 'list_dir',
              input: {},
            },
          },
        ],
      });
      messages.push({
        role: 'user',
        content: [
          {
            toolResult: {
              toolUseId: `t${i}`,
              content: [{ text: `out ${i}` }],
              status: 'success',
            },
          },
        ],
      });
    }
    const before = messages.length;
    const out = compactSessionMessages(messages);
    expect(out.compacted).toBe(true);
    expect(out.messages.length).toBeLessThan(before);
    const joined = JSON.stringify(out.messages);
    expect(joined).toContain('Compacted earlier context');
    expect(joined).toContain('scaffold app');
  });

  it('summarizeDroppedMessages extracts tool names', () => {
    const text = summarizeDroppedMessages([
      {
        role: 'assistant',
        content: [
          {
            toolUse: { toolUseId: '1', name: 'glob', input: {} },
          },
        ],
      },
    ]);
    expect(text).toContain('toolUse:glob');
  });
});

describe('P1 patch', () => {
  it('applies sequential unique hunks', () => {
    const before = 'aaa\nbbb\nccc\n';
    const after = applyPatchEdits(before, [
      { old_str: 'aaa', new_str: 'AAA' },
      { old_str: 'ccc', new_str: 'CCC' },
    ]);
    expect(after).toBe('AAA\nbbb\nCCC\n');
  });

  it('rejects ambiguous old_str', () => {
    expect(() =>
      applyPatchEdits('x x', [{ old_str: 'x', new_str: 'y' }]),
    ).toThrow(/unique/);
  });

  it('normalizePatchEdits validates input', () => {
    expect(() => normalizePatchEdits([])).toThrow(/non-empty/);
    expect(normalizePatchEdits([{ old_str: 'a', new_str: 'b' }])).toEqual([
      { old_str: 'a', new_str: 'b' },
    ]);
  });

  it('applyDiffString accepts JSON edits', () => {
    expect(
      applyDiffString('hello world', JSON.stringify([{ old_str: 'world', new_str: 'there' }])),
    ).toBe('hello there');
  });

  it('executeTool apply_patch writes via host', async () => {
    const host = createFakeHost({
      autoApprove: true,
      files: { 'src/a.ts': 'const a = 1;\nconst b = 2;\n' },
    });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'p1',
        name: 'apply_patch',
        input: {
          path: 'src/a.ts',
          edits: [
            { old_str: 'const a = 1;', new_str: 'const a = 10;' },
            { old_str: 'const b = 2;', new_str: 'const b = 20;' },
          ],
        },
      },
    });
    expect(result.status).toBe('success');
    expect(host.files.get('src/a.ts')).toBe(
      'const a = 10;\nconst b = 20;\n',
    );
  });

  it('tool def exists', () => {
    expect(getToolDef('apply_patch')?.name).toBe('apply_patch');
  });

  it('executeTool edit_file applies whitespace-tolerant anchors', async () => {
    const host = createFakeHost({
      autoApprove: true,
      files: { 'src/a.ts': '  const a = 1;  \n' },
    });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'fuzzy1',
        name: 'edit_file',
        input: {
          path: 'src/a.ts',
          old_str: 'const a = 1;\n',
          new_str: 'const a = 2;\n',
        },
      },
    });
    expect(result.status).toBe('success');
    expect(host.files.get('src/a.ts')).toBe('  const a = 2;\n');
  });

  it('read_file does not unlock a failed edit anchor', async () => {
    const host = createFakeHost({
      autoApprove: true,
      files: { 'src/a.ts': 'hello\n' },
    });
    const cache = createEditAnchorFailCache();
    const fail = await executeTool({
      host,
      tool: {
        toolUseId: 'e1',
        name: 'edit_file',
        input: {
          path: 'src/a.ts',
          old_str: 'nope',
          new_str: 'x',
        },
      },
      editAnchorFails: cache,
    });
    expect(fail.status).toBe('error');
    expect(fail.content).toMatch(/edit_mismatch/);

    await executeTool({
      host,
      tool: {
        toolUseId: 'r1',
        name: 'read_file',
        input: { path: 'src/a.ts' },
      },
      editAnchorFails: cache,
    });

    const again = await executeTool({
      host,
      tool: {
        toolUseId: 'e2',
        name: 'edit_file',
        input: {
          path: 'src/a.ts',
          old_str: 'nope',
          new_str: 'x',
        },
      },
      editAnchorFails: cache,
    });
    expect(again.status).toBe('error');
    expect(again.content).toMatch(/Refused identical old_str/);
  });

  it('path-level gate blocks surgical edits after N mismatches', async () => {
    const host = createFakeHost({
      autoApprove: true,
      files: { 'src/a.ts': 'hello world\n' },
    });
    const pathState = createEditPathMismatchState(2);
    const anchors = createEditAnchorFailCache();
    const fail1 = await executeTool({
      host,
      tool: {
        toolUseId: 'm1',
        name: 'edit_file',
        input: { path: 'src/a.ts', old_str: 'zzz1', new_str: 'x' },
      },
      editAnchorFails: anchors,
      editPathMismatches: pathState,
    });
    expect(fail1.status).toBe('error');
    expect(fail1.content).toMatch(/path_gate/);
    expect(fail1.content).toMatch(/≤400 lines|small file/i);

    const fail2 = await executeTool({
      host,
      tool: {
        toolUseId: 'm2',
        name: 'edit_file',
        input: { path: 'src/a.ts', old_str: 'zzz2', new_str: 'x' },
      },
      editAnchorFails: anchors,
      editPathMismatches: pathState,
    });
    expect(fail2.status).toBe('error');
    expect(fail2.content).toMatch(/blocked|write_file/i);

    const blocked = await executeTool({
      host,
      tool: {
        toolUseId: 'm3',
        name: 'edit_file',
        input: { path: 'src/a.ts', old_str: 'zzz3', new_str: 'x' },
      },
      editAnchorFails: anchors,
      editPathMismatches: pathState,
    });
    expect(blocked.status).toBe('error');
    expect(blocked.content).toMatch(/Path-level gate/);
    expect(blocked.content).toMatch(/write_file/);
  });

  it('low-friction auto-approve for small patches', () => {
    expect(
      shouldAutoApprove({
        autonomy: 'low_friction',
        toolName: 'apply_patch',
        input: {
          path: 'src/a.ts',
          edits: [{ old_str: 'a', new_str: 'b' }],
        },
      }),
    ).toBe(true);
    expect(
      isLowFrictionPatchEligible({
        path: '.env',
        edits: [{ old_str: 'a', new_str: 'b' }],
      }),
    ).toBe(false);
  });
});

describe('P1 actionBias', () => {
  it('always / never override regex', () => {
    expect(looksLikeActionTask('what is in src?')).toBe(false);
    expect(shouldTreatAsActionTask('what is in src?', 'always')).toBe(true);
    expect(shouldTreatAsActionTask('create a file', 'never')).toBe(false);
    expect(shouldTreatAsActionTask('create a file', 'auto')).toBe(true);
  });

  it('buildUserTurn includes execution requirement when always', () => {
    const text = buildUserTurn({
      prompt: 'look around',
      actionBias: 'always',
    });
    expect(text).toContain('Execution requirement');
    expect(text).toContain('apply_patch');
  });
});

describe('P1 review + parallel sets', () => {
  it('isReviewOk parses marker', () => {
    expect(isReviewOk(`${REVIEW_OK_MARKER}\nLooks good.`)).toBe(true);
    expect(isReviewOk('REVIEW_ISSUES:\n- missing file')).toBe(false);
  });

  it('PARALLEL_SAFE_TOOLS covers gather reads only', () => {
    expect(PARALLEL_SAFE_TOOLS.has('read_file')).toBe(true);
    expect(PARALLEL_SAFE_TOOLS.has('glob')).toBe(true);
    expect(PARALLEL_SAFE_TOOLS.has('write_file')).toBe(false);
    expect(PARALLEL_SAFE_TOOLS.has('run_terminal')).toBe(false);
    expect(PARALLEL_SAFE_TOOLS.has('apply_patch')).toBe(false);
  });
});
