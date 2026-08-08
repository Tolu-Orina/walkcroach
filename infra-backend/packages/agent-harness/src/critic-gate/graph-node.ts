/**
 * Adapt CriticGate as a Graph `gate` node (Phase 5 Critique stage).
 */
import type { GraphNodeDef, GraphState } from '../graph/types.js';
import { runCriticGate } from './gate.js';
import type { CriticArtifact, CriticCheck, CriticEnforcement } from './types.js';

export type CriticGateGraphState = GraphState & {
  /** Files to critique — set by Draft node. */
  artifacts?: CriticArtifact[];
  criticPass?: boolean;
  criticEnforcement?: CriticEnforcement['action'];
  criticRevisePrompt?: string;
  criticErrorCount?: number;
};

export function createCriticGateGraphNode(opts: {
  id?: string;
  checks: readonly CriticCheck[];
  reviseOnError?: boolean;
  enableModelCritic?: boolean;
  modelCritic?: import('./types.js').ModelCritic;
  /** Pull artifacts from state; default `state.artifacts`. */
  getArtifacts?: (state: CriticGateGraphState) => CriticArtifact[];
}): GraphNodeDef<CriticGateGraphState> {
  return {
    id: opts.id ?? 'critique',
    kind: 'gate',
    run: async ({ state, emit }) => {
      const artifacts =
        opts.getArtifacts?.(state) ??
        (Array.isArray(state.artifacts) ? state.artifacts : []);

      const enforcement = await runCriticGate({
        checks: opts.checks,
        context: { artifacts, meta: { graph: true } },
        reviseOnError: opts.reviseOnError,
        enableModelCritic: opts.enableModelCritic,
        modelCritic: opts.modelCritic,
        onEvent: async (e) => {
          await emit(e.type, e as unknown as Record<string, unknown>);
        },
      });

      if (enforcement.action === 'pass') {
        return {
          criticPass: true,
          criticEnforcement: 'pass',
          criticRevisePrompt: undefined,
          criticErrorCount: 0,
        };
      }

      return {
        criticPass: false,
        criticEnforcement: enforcement.action,
        criticRevisePrompt:
          enforcement.action === 'revise' ? enforcement.revisePrompt : undefined,
        criticErrorCount: enforcement.errorFindings.length,
      };
    },
  };
}
