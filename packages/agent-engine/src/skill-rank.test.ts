import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatSkillRankNudge,
  mergeRemoteSkillHits,
  rankSkills,
  skillContentHash,
  skillEmbedText,
  SKILLS_VECTORS_REL_PATH,
} from './skill-rank.js';

function unitVec(i: number, dim = 8): number[] {
  const v = Array.from({ length: dim }, () => 0);
  v[i % dim] = 1;
  return v;
}

describe('skill-rank', () => {
  it('skillEmbedText includes name, description, and truncated body', () => {
    const text = skillEmbedText({
      name: 'foo',
      description: 'desc',
      source: 'bundled',
      body: 'x'.repeat(2000),
    });
    expect(text).toContain('# foo');
    expect(text).toContain('desc');
    expect(text.length).toBeLessThan(2000 + 50);
  });

  it('ranks by cosine similarity and applies keyword boost', async () => {
    const skills = [
      {
        name: 'txn-retries',
        description: 'Handle CockroachDB transaction retries',
        source: 'bundled' as const,
        body: 'use SAVEPOINT cockroach_restart',
      },
      {
        name: 'frontend-polish',
        description: 'UI spacing and typography',
        source: 'bundled' as const,
        body: 'use 8px grid',
      },
    ];

    const embedMap = new Map<string, number[]>([
      [skillEmbedText(skills[0]!), unitVec(0)],
      [skillEmbedText(skills[1]!), unitVec(1)],
      ['retry serialization failures in cockroach', unitVec(0)],
    ]);

    const hits = await rankSkills({
      query: 'retry serialization failures in cockroach',
      skills,
      embed: async (t) => embedMap.get(t) ?? unitVec(7),
      keywordNames: ['txn-retries'],
      minScore: 0,
      topK: 2,
    });

    expect(hits[0]?.name).toBe('txn-retries');
    expect(hits[0]?.keywordBoost).toBe(true);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it('persists embeddings under .walkcroach/index/skills-vectors.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wc-skill-rank-'));
    let embedCalls = 0;
    const skills = [
      {
        name: 'a-skill',
        description: 'alpha',
        source: 'workspace' as const,
        body: 'body-a',
      },
    ];
    const vec = unitVec(2);
    const embed = async () => {
      embedCalls += 1;
      return vec;
    };

    await rankSkills({
      query: 'alpha topic',
      skills,
      embed,
      workspaceRoot: root,
      minScore: 0,
    });
    const firstCalls = embedCalls;

    await rankSkills({
      query: 'alpha topic again',
      skills,
      embed,
      workspaceRoot: root,
      minScore: 0,
    });

    // Second pass should re-embed only the query, not the skill.
    expect(embedCalls).toBe(firstCalls + 1);

    const raw = await readFile(join(root, SKILLS_VECTORS_REL_PATH), 'utf8');
    const parsed = JSON.parse(raw) as {
      entries: Record<string, { hash: string }>;
    };
    expect(parsed.entries['a-skill']?.hash).toBe(skillContentHash(skills[0]!));
  });

  it('formatSkillRankNudge is empty when there are no hits', () => {
    expect(formatSkillRankNudge([])).toBe('');
  });

  it('mergeRemoteSkillHits converts distance to similarity and merges', () => {
    const merged = mergeRemoteSkillHits({
      local: [
        {
          name: 'local-only',
          description: 'l',
          source: 'bundled',
          score: 0.4,
        },
      ],
      remote: [
        {
          name: 'shared-hit',
          description: 's',
          distance: 0.2,
        },
        {
          name: 'local-only',
          description: 'l',
          distance: 0.05,
        },
      ],
      minScore: 0.1,
      topK: 5,
    });
    expect(merged[0]?.name).toBe('local-only');
    expect(merged[0]?.score).toBeGreaterThanOrEqual(0.95);
    expect(merged.some((h) => h.name === 'shared-hit')).toBe(true);
  });
});
