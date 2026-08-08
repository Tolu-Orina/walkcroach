/**
 * Phase 5 — content.publish Graph eval suite (mock AgentRunner, no Bedrock).
 *
 * Exit criteria covered here:
 * 1. Eval suite with explicit success rate
 * 3. Zero forbidden `@/` on succeeded outputs (when alias not allowed)
 * 5. Auto-approved plan always present in Draft (`plan.auto_approved` + approvedPlan)
 * Dual Critique deleted: only Graph Critique path (no linear 4a fail-closed)
 */
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '@walkcroach/db';
import {
  CONTENT_PUBLISH_GRAPH_ID,
  publishContent,
  type AgentRunner,
} from './index.js';

vi.mock('./memory.js', () => ({
  listProjectMemoryEntries: vi.fn(async () => []),
  writeMemoryEntry: vi.fn(async () => undefined),
}));

vi.mock('./github-pr.js', () => ({
  getInstallationToken: vi.fn(),
  readRepoContext: vi.fn(),
  openContentPullRequest: vi.fn(),
  contentBranchName: (t: string) => `content/${t}`,
}));

function fakeDb(): DbClient {
  return { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as DbClient;
}

const PLAN = `
## Goal
Ship a blog post page.

## Context
React content route.

## Files to modify
- (none)

## Files to create
- src/content/blog/hello.tsx

## Implementation steps
1. Create the page component

## Verification criteria
- File exists

## Risks
- Style drift
`.trim();

function makeRunner(opts: {
  draftContent: string;
  reviseContent?: string;
  failPlan?: boolean;
}): AgentRunner {
  let reviseCalls = 0;
  return async ({ role, approvedPlan }) => {
    if (role === 'plan') {
      if (opts.failPlan) {
        return {
          ok: false,
          reason: 'incomplete',
          filesWritten: [],
          snapshot: {},
          refusals: [],
        };
      }
      return {
        ok: true,
        reason: 'plan_ready',
        filesWritten: [],
        snapshot: {},
        refusals: [],
        approvedPlan: PLAN,
      };
    }

    if (!approvedPlan) {
      return {
        ok: false,
        reason: 'plan_missing',
        filesWritten: [],
        snapshot: {},
        refusals: [],
        error: 'Draft without plan',
      };
    }

    const body =
      role === 'revise' && opts.reviseContent
        ? (++reviseCalls, opts.reviseContent)
        : opts.draftContent;

    const path = 'src/content/blog/hello.tsx';
    return {
      ok: true,
      reason: 'completed',
      filesWritten: [path],
      snapshot: { [`/workspace/${path}`]: body },
      refusals: [],
    };
  };
}

describe('Phase 5 content.publish Graph', () => {
  it('registers as content.publish graph id', () => {
    expect(CONTENT_PUBLISH_GRAPH_ID).toBe('content.publish');
  });

  it('auto-approves plan into Draft and emits plan.auto_approved (exit #5)', async () => {
    const events: string[] = [];
    const result = await publishContent({
      db: fakeDb(),
      projectId: '11111111-1111-1111-1111-111111111111',
      source: {
        kind: 'markdown',
        text: '# Hello\n\nWorld',
        title: 'Hello',
      },
      dryRun: true,
      noTarget: true,
      onStageEvent: (type) => {
        events.push(type);
      },
      runAgent: makeRunner({
        draftContent: `export default function Hello() { return <h1>Hello</h1>; }\n`,
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.planAutoApproved).toBe(true);
    expect(result.approvedPlan).toMatch(/## Goal/);
    expect(events).toContain('plan.auto_approved');
    expect(events.some((e) => e.startsWith('stage.'))).toBe(true);
  });

  it('blocks forbidden @/ then revises to clean output (exit #3)', async () => {
    const result = await publishContent({
      db: fakeDb(),
      projectId: '11111111-1111-1111-1111-111111111111',
      source: { kind: 'markdown', text: '# Post\n\nBody', title: 'Post' },
      dryRun: true,
      noTarget: true,
      runAgent: makeRunner({
        draftContent: `import { x } from '@/lib';\nexport default function P(){return <p/>}\n`,
        reviseContent: `export default function P(){return <p>ok</p>}\n`,
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.files?.[0]?.content).not.toMatch(/@\//);
    expect(result.planAutoApproved).toBe(true);
  });

  it('fail-closes when revise cannot clear CriticGate', async () => {
    const bad = `import { x } from '@/lib';\nexport default function P(){return <p/>}\n`;
    const result = await publishContent({
      db: fakeDb(),
      projectId: '11111111-1111-1111-1111-111111111111',
      source: { kind: 'markdown', text: '# Post', title: 'Post' },
      dryRun: true,
      noTarget: true,
      runAgent: makeRunner({ draftContent: bad, reviseContent: bad }),
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('critic_blocked');
  });

  it('fails when Planner does not submit a plan', async () => {
    const result = await publishContent({
      db: fakeDb(),
      projectId: '11111111-1111-1111-1111-111111111111',
      source: { kind: 'markdown', text: '# Post', title: 'Post' },
      dryRun: true,
      noTarget: true,
      runAgent: makeRunner({
        draftContent: 'x',
        failPlan: true,
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/plan|incomplete/);
  });
});

describe('Phase 5 eval suite (explicit success rate)', () => {
  const cases: Array<{
    id: string;
    draft: string;
    revise?: string;
    expectOk: boolean;
  }> = [
    {
      id: 'clean-tsx',
      draft: `export default function A(){return <article>hi</article>}\n`,
      expectOk: true,
    },
    {
      id: 'alias-then-fix',
      draft: `import x from '@/x';\nexport default function A(){return null}\n`,
      revise: `export default function A(){return null}\n`,
      expectOk: true,
    },
    {
      id: 'eval-blocked',
      draft: `export default function A(){ return eval('1') as never }\n`,
      revise: `export default function A(){ return eval('1') as never }\n`,
      expectOk: false,
    },
    {
      id: 'script-blocked',
      draft: `export default function A(){ return <script>x</script> as never }\n`,
      revise: `export default function A(){ return <script>x</script> as never }\n`,
      expectOk: false,
    },
    {
      id: 'clean-with-props',
      draft: `export default function Post({title}:{title:string}){return <h1>{title}</h1>}\n`,
      expectOk: true,
    },
    {
      id: 'relative-import-ok',
      draft: `import { Card } from '../ui/card';\nexport default function A(){return <Card/>}\n`,
      expectOk: true,
    },
    {
      id: 'alias-persist-fail',
      draft: `import {a} from '@/a';\nexport default function A(){return null}\n`,
      revise: `import {a} from '@/a';\nexport default function A(){return null}\n`,
      expectOk: false,
    },
    {
      id: 'markdownish-tsx',
      draft: `export default function A(){return (<main><h1>Title</h1><p>Body</p></main>)}\n`,
      expectOk: true,
    },
    {
      id: 'credential-blocked',
      draft: `const k = 'ghp_012345678901234567890123456789012345';\nexport default function A(){return null}\n`,
      revise: `const k = 'ghp_012345678901234567890123456789012345';\nexport default function A(){return null}\n`,
      expectOk: false,
    },
    {
      id: 'clean-fragment',
      draft: `export default function A(){return <><h1>Hi</h1></>}\n`,
      expectOk: true,
    },
  ];

  it(`runs ${cases.length} cases and reports success rate`, async () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);

    let passed = 0;
    for (const c of cases) {
      const result = await publishContent({
        db: fakeDb(),
        projectId: '11111111-1111-1111-1111-111111111111',
        source: { kind: 'markdown', text: `# ${c.id}`, title: c.id },
        dryRun: true,
        noTarget: true,
        runAgent: makeRunner({
          draftContent: c.draft,
          reviseContent: c.revise,
        }),
      });
      const ok = result.ok === c.expectOk;
      if (ok) passed += 1;
      expect(ok, `${c.id}: ok=${result.ok} reason=${result.reason}`).toBe(true);
      if (result.ok) {
        expect(result.planAutoApproved).toBe(true);
        expect(result.approvedPlan).toBeTruthy();
        // Succeeded outputs must not carry forbidden @/ when alias not in house style.
        for (const f of result.files ?? []) {
          expect(f.content, c.id).not.toMatch(/from\s+['"]@\//);
        }
      }
    }

    const rate = passed / cases.length;
    // Explicit success rate for the suite (quality SLI).
    expect(rate).toBe(1);
    expect(passed).toBe(cases.length);
  });
});
