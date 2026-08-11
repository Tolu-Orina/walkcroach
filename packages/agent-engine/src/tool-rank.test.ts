import { describe, expect, it } from 'vitest';
import {
  ACT_TOOL_KEEP_ALWAYS,
  ACT_TOOL_RANK_BUDGET,
  DEFAULT_TOOL_RANK_TOP_K,
  assertActToolBudget,
  candidatesFromToolNames,
  mergeActAllowlistWithRank,
  rankTools,
  splitActAllowlistForRank,
  toolEmbedText,
  toolKeywordBoost,
} from './tool-rank.js';
import { resolvePhaseAllowlist } from './phase-graph.js';

describe('tool-rank P4', () => {
  it('splitActAllowlistForRank keeps core and pools optionals', () => {
    const full = resolvePhaseAllowlist({
      phase: 'act',
      includePhaseB: true,
      includeExtendedAct: true,
      includeSubagents: true,
    });
    const { keep, optional } = splitActAllowlistForRank(full);
    expect(keep).toEqual([...ACT_TOOL_KEEP_ALWAYS]);
    expect(optional).toContain('cockroach_mcp');
    expect(optional).toContain('terminal_session');
    expect(optional).toContain('spawn_subagent');
    expect(optional).not.toContain('write_file');
  });

  it('mergeActAllowlistWithRank stays ≤ budget and preserves order', () => {
    const full = resolvePhaseAllowlist({
      phase: 'act',
      includePhaseB: true,
      includeExtendedAct: true,
      includeSubagents: true,
      includePhaseC: true,
      includeSharedSkills: true,
    });
    expect(full.length).toBeGreaterThan(ACT_TOOL_RANK_BUDGET);

    const merged = mergeActAllowlistWithRank({
      fullAllowlist: full,
      rankedOptionalNames: [
        'cockroach_mcp',
        'ccloud',
        'spawn_subagent',
        'todo_write', // 4th should be dropped at maxExtras=3
      ],
      maxExtras: DEFAULT_TOOL_RANK_TOP_K,
    });

    expect(merged.length).toBeLessThanOrEqual(ACT_TOOL_RANK_BUDGET);
    expect(() => assertActToolBudget(merged)).not.toThrow();
    expect(merged).toContain('cockroach_mcp');
    expect(merged).toContain('ccloud');
    expect(merged).toContain('spawn_subagent');
    expect(merged).not.toContain('todo_write');
    // Stable relative order from full allowlist
    expect(merged.indexOf('write_file')).toBeLessThan(merged.indexOf('edit_file'));
    expect(merged.indexOf('cockroach_mcp')).toBeLessThan(
      merged.indexOf('ccloud'),
    );
  });

  it('toolKeywordBoost prefers cockroach tools on SQL queries', () => {
    expect(
      toolKeywordBoost(
        'Explain this CockroachDB SELECT and schema',
        'cockroach_mcp',
        'Managed MCP',
      ),
    ).toBe(true);
    expect(
      toolKeywordBoost('fix typo in README', 'cockroach_mcp', 'Managed MCP'),
    ).toBe(false);
  });

  it('rankTools orders by cosine + keyword and respects topK', async () => {
    const tools = candidatesFromToolNames([
      'cockroach_mcp',
      'ccloud',
      'terminal_session',
      'enter_worktree',
    ]);
    expect(tools.length).toBe(4);

    // Name-keyed fake embed (ignore description body so Cloud copy cannot collide).
    const embed = async (text: string) => {
      const header = text.toLowerCase().split('\n')[0] ?? '';
      if (header === '# cockroach_mcp') return [1, 0, 0, 0];
      if (header === '# ccloud') return [0, 1, 0, 0];
      if (header === '# enter_worktree') return [0, 0, 1, 0];
      if (header === '# terminal_session') return [0, 0, 0, 1];
      // Query vector aligned with cockroach_mcp
      return [1, 0, 0, 0];
    };

    const hits = await rankTools({
      query: 'Run EXPLAIN on a CockroachDB SQL query',
      tools,
      embed,
      topK: 2,
      minScore: 0.1,
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(hits[0]!.name).toBe('cockroach_mcp');
  });

  it('toolEmbedText includes name + description', () => {
    const text = toolEmbedText({
      name: 'mcp_call',
      description: 'Call an extra MCP server tool',
    });
    expect(text).toMatch(/mcp_call/);
    expect(text).toMatch(/extra MCP/);
  });
});
