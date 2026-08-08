/**
 * Phase 4 CriticGate — enforcement floor + Tier 2/3 stubs.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createForbiddenImportCheck,
  createJsonObjectSchemaCheck,
  createMinArtifactsCheck,
  createOutputRedFlagCheck,
  createTier2ModelCriticStub,
  createTier3ModelCriticStub,
  createTier2HeuristicModelCritic,
  createTier3LlmModelCritic,
  createCriticGateGraphNode,
  defaultPublishCriticChecks,
  isCriticBlocked,
  ModelCriticNotEnabledError,
  resolveModelCriticFromEnv,
  runCriticGate,
} from './index.js';
import { MemoryGraphCheckpointer, defineGraph, runGraph } from '../graph/index.js';

describe('runCriticGate (enforcement, not evaluation-only)', () => {
  it('passes clean artifacts', async () => {
    const e = await runCriticGate({
      checks: defaultPublishCriticChecks({ allowedImportPrefixes: ['@/'] }),
      context: {
        artifacts: [
          {
            path: 'src/post.tsx',
            content: `import { x } from '@/lib';\nexport default function Post() { return <p>hi</p>; }\n`,
          },
        ],
      },
    });
    expect(e.action).toBe('pass');
    expect(isCriticBlocked(e)).toBe(false);
  });

  it('blocks forbidden @/ when alias is not allowed (quality scenario #4)', async () => {
    const events: string[] = [];
    const e = await runCriticGate({
      checks: defaultPublishCriticChecks({ allowedImportPrefixes: [] }),
      context: {
        artifacts: [
          {
            path: 'src/post.tsx',
            content: `import { Card } from '@/components/ui/card';\n`,
          },
        ],
      },
      onEvent: (ev) => {
        events.push(ev.type);
      },
    });
    expect(e.action).toBe('revise');
    if (e.action !== 'revise') return;
    expect(e.errorFindings.some((f) => f.rule === 'forbidden_import')).toBe(true);
    expect(e.revisePrompt).toMatch(/Forbidden import/);
    expect(events).toContain('critic.findings');
    expect(events).toContain('critic.enforcement');
    expect(isCriticBlocked(e)).toBe(true);
  });

  it('allows @/ when house-style alias is declared', async () => {
    const e = await runCriticGate({
      checks: [
        createForbiddenImportCheck({
          forbidden: ['@/'],
          allowed: ['@/'],
        }),
      ],
      context: {
        artifacts: [
          {
            path: 'src/a.tsx',
            content: `import x from '@/foo';\n`,
          },
        ],
      },
    });
    expect(e.action).toBe('pass');
  });

  it('fail-closes on error when reviseOnError is false (Phase 4a publish path)', async () => {
    const e = await runCriticGate({
      checks: [createOutputRedFlagCheck()],
      context: {
        artifacts: [
          {
            path: 'src/a.tsx',
            content: 'const x = eval("1");\n',
          },
        ],
      },
      reviseOnError: false,
    });
    expect(e.action).toBe('fail');
    if (e.action !== 'fail') return;
    expect(e.reason).toMatch(/dynamic-eval|red-flag/i);
  });

  it('emits warnings without blocking', async () => {
    // Force a warning-only finding via custom check.
    const e = await runCriticGate({
      checks: [
        {
          id: 'warn.only',
          tier: 1,
          run: () => [
            {
              checkId: 'warn.only',
              rule: 'style_nit',
              severity: 'warning',
              message: 'prefer const',
            },
          ],
        },
      ],
      context: { artifacts: [{ path: 'a.ts', content: 'let x = 1' }] },
    });
    expect(e.action).toBe('pass');
    expect(e.findings).toHaveLength(1);
  });

  it('validates JSON object schema (tool-call floor)', async () => {
    const check = createJsonObjectSchemaCheck({
      required: ['title', 'ok'],
      properties: { title: 'string', ok: 'boolean' },
    });
    const bad = await runCriticGate({
      checks: [check],
      context: { artifacts: [], data: { title: 1 } },
      reviseOnError: false,
    });
    expect(bad.action).toBe('fail');

    const good = await runCriticGate({
      checks: [check, createMinArtifactsCheck({ min: 0 })],
      context: {
        artifacts: [],
        data: { title: 'Launch', ok: true },
      },
    });
    expect(good.action).toBe('pass');
  });
});

describe('model critic stubs (Phase 7 gated)', () => {
  it('does not invoke model critic by default even if provided', async () => {
    const critique = vi.fn();
    const e = await runCriticGate({
      checks: [createMinArtifactsCheck({ min: 0 })],
      context: { artifacts: [] },
      modelCritic: {
        tier: 2,
        id: 'spy',
        critique,
      },
    });
    expect(e.action).toBe('pass');
    expect(critique).not.toHaveBeenCalled();
  });

  it('tier stubs throw ModelCriticNotEnabledError when called', async () => {
    const t2 = createTier2ModelCriticStub();
    const t3 = createTier3ModelCriticStub();
    await expect(
      t2.critique({ artifacts: [], floorFindings: [] }),
    ).rejects.toBeInstanceOf(ModelCriticNotEnabledError);
    await expect(
      t3.critique({ artifacts: [], floorFindings: [] }),
    ).rejects.toBeInstanceOf(ModelCriticNotEnabledError);
  });
});

describe('Phase 7 model critic implementations', () => {
  it('Tier 2 heuristic blocks TODO/FIXME when enabled', async () => {
    const events: string[] = [];
    const e = await runCriticGate({
      checks: [createMinArtifactsCheck({ min: 0 })],
      context: {
        artifacts: [
          {
            path: 'src/post.tsx',
            content:
              'export default function Post() {\n  // TODO: finish body\n  return <p>x</p>;\n}\n',
          },
        ],
      },
      enableModelCritic: true,
      modelCritic: createTier2HeuristicModelCritic(),
      onEvent: (ev) => {
        events.push(ev.type);
      },
    });
    expect(e.action).toBe('revise');
    expect(e.findings.some((f) => f.rule === 'unfinished_marker')).toBe(true);
    expect(events).toContain('critic.model_invoked');
  });

  it('Tier 3 LLM judge parses injected JSON and fail-softs on throw', async () => {
    const good = await runCriticGate({
      checks: [createMinArtifactsCheck({ min: 0 })],
      context: {
        artifacts: [{ path: 'a.tsx', content: 'export const x = 1;\n'.repeat(20) }],
      },
      enableModelCritic: true,
      modelCritic: createTier3LlmModelCritic({
        invoke: async () =>
          JSON.stringify([
            {
              rule: 'weak_cta',
              severity: 'warning',
              message: 'Consider a clearer call to action',
              path: 'a.tsx',
            },
          ]),
      }),
    });
    expect(good.action).toBe('pass');
    expect(good.findings.some((f) => f.rule === 'weak_cta')).toBe(true);

    const soft = await runCriticGate({
      checks: [createMinArtifactsCheck({ min: 0 })],
      context: { artifacts: [{ path: 'a.tsx', content: 'ok enough content here for length' }] },
      enableModelCritic: true,
      modelCritic: createTier3LlmModelCritic({
        invoke: async () => {
          throw new Error('bedrock down');
        },
      }),
    });
    expect(soft.action).toBe('pass');
  });

  it('resolveModelCriticFromEnv defaults off', () => {
    const prev = process.env.WALKCROACH_ENABLE_MODEL_CRITIC;
    delete process.env.WALKCROACH_ENABLE_MODEL_CRITIC;
    expect(resolveModelCriticFromEnv().enableModelCritic).toBe(false);
    process.env.WALKCROACH_ENABLE_MODEL_CRITIC = '1';
    process.env.WALKCROACH_MODEL_CRITIC_TIER = '2';
    const on = resolveModelCriticFromEnv();
    expect(on.enableModelCritic).toBe(true);
    expect(on.tier).toBe(2);
    expect(on.modelCritic?.tier).toBe(2);
    if (prev === undefined) delete process.env.WALKCROACH_ENABLE_MODEL_CRITIC;
    else process.env.WALKCROACH_ENABLE_MODEL_CRITIC = prev;
    delete process.env.WALKCROACH_MODEL_CRITIC_TIER;
  });
});

describe('CriticGate as Graph gate node', () => {
  it('sets criticPass false → revise edge can fire', async () => {
    const critique = createCriticGateGraphNode({
      checks: defaultPublishCriticChecks({ allowedImportPrefixes: [] }),
    });
    const graph = defineGraph({
      id: 'dummy.critic',
      entry: 'draft',
      maxNodeExecutions: 6,
      nodes: [
        {
          id: 'draft',
          kind: 'code',
          run: async () => ({
            artifacts: [
              {
                path: 'src/x.tsx',
                content: `import { a } from '@/a';\n`,
              },
            ],
          }),
        },
        critique,
        {
          id: 'revise',
          kind: 'code',
          run: async ({ state }) => ({
            revised: true,
            // Fix the forbidden import on revise.
            artifacts: [
              {
                path: 'src/x.tsx',
                content: `import { a } from './a';\n`,
              },
            ],
            criticPass: undefined,
          }),
        },
        {
          id: 'done',
          kind: 'code',
          run: async () => ({ finished: true }),
        },
      ],
      edges: [
        { from: 'draft', to: 'critique' },
        {
          from: 'critique',
          to: 'done',
          when: (s) => Boolean(s.criticPass),
        },
        {
          from: 'critique',
          to: 'revise',
          when: (s) => !s.criticPass,
        },
        { from: 'revise', to: 'critique' },
        { from: 'done', to: null },
      ],
    });

    const outcome = await runGraph({
      runId: 'critic-graph',
      graph,
      checkpointer: new MemoryGraphCheckpointer(),
      initialState: {},
    });
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') return;
    expect(outcome.state.finished).toBe(true);
    expect(outcome.state.revised).toBe(true);
    expect(outcome.reviseCount).toBe(0); // reviseDelta not used; cycle via edges
  });
});
