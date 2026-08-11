import { describe, expect, it } from 'vitest';
import {
  CRITIC_TOOL_ALLOWLIST,
  MAX_ARCHITECTURE_CRITIQUES,
  buildArchitectureCriticPrompt,
  isCriticSpawnName,
  isCriticToolName,
  shouldRunArchitectureCritic,
} from './architecture-critic.js';
import { REVIEW_OK_MARKER, isReviewOk } from './review-markers.js';
import { PLANNER_FORBIDDEN_TOOLS } from './planner.js';

describe('architecture critic', () => {
  it('allowlist is read-only (no planner forbidden tools)', () => {
    for (const name of CRITIC_TOOL_ALLOWLIST) {
      expect(isCriticToolName(name)).toBe(true);
      expect((PLANNER_FORBIDDEN_TOOLS as readonly string[]).includes(name)).toBe(
        false,
      );
    }
    expect(CRITIC_TOOL_ALLOWLIST).not.toContain('submit_plan');
    expect(CRITIC_TOOL_ALLOWLIST).not.toContain('write_file');
  });

  it('buildArchitectureCriticPrompt includes checklist + optional git', () => {
    const text = buildArchitectureCriticPrompt({
      task: '  add billing webhook  ',
      gitStatus: '## main\n M src/a.ts',
    });
    expect(text).toMatch(/Architecture critic/);
    expect(text).toMatch(/billing webhook/);
    expect(text).toMatch(/Layering/);
    expect(text).toMatch(/git status/);
    expect(text).toContain(REVIEW_OK_MARKER);
  });

  it('shouldRunArchitectureCritic gates on flag / depth / mutating / cap', () => {
    expect(
      shouldRunArchitectureCritic({
        enabled: true,
        depth: 0,
        actionMutating: true,
        critiquesUsed: 0,
      }),
    ).toBe(true);
    expect(
      shouldRunArchitectureCritic({
        enabled: false,
        depth: 0,
        actionMutating: true,
        critiquesUsed: 0,
      }),
    ).toBe(false);
    expect(
      shouldRunArchitectureCritic({
        enabled: true,
        depth: 1,
        actionMutating: true,
        critiquesUsed: 0,
      }),
    ).toBe(false);
    expect(
      shouldRunArchitectureCritic({
        enabled: true,
        depth: 0,
        actionMutating: false,
        critiquesUsed: 0,
      }),
    ).toBe(false);
    expect(
      shouldRunArchitectureCritic({
        enabled: true,
        depth: 0,
        actionMutating: true,
        critiquesUsed: MAX_ARCHITECTURE_CRITIQUES,
      }),
    ).toBe(false);
  });

  it('isCriticSpawnName + REVIEW_OK markers', () => {
    expect(isCriticSpawnName('architecture-critic')).toBe(true);
    expect(isCriticSpawnName('Critic')).toBe(true);
    expect(isCriticSpawnName('explore')).toBe(false);
    expect(isReviewOk(`${REVIEW_OK_MARKER}\nFine`)).toBe(true);
    expect(isReviewOk('REVIEW_ISSUES:\n- leak')).toBe(false);
  });
});
