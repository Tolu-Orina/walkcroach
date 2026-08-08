/**
 * Tier 2/3 model-critic stubs — Phase 7 gated.
 *
 * Present so Phase 4 callers can type against the cascade without wiring cost.
 * Default CriticGate never invokes these unless `enableModelCritic: true`.
 */
import type { ModelCritic, ModelCriticRequest, ModelCriticResult } from './types.js';

export class ModelCriticNotEnabledError extends Error {
  constructor(tier: 2 | 3, id: string) {
    super(
      `Model critic ${id} (tier ${tier}) is not enabled. Phase 7 is evidence-gated; keep enableModelCritic false.`,
    );
    this.name = 'ModelCriticNotEnabledError';
  }
}

/** Tier 2 stub — lightweight judge (e.g. Luna-class). */
export function createTier2ModelCriticStub(id = 'critic.tier2.stub'): ModelCritic {
  return {
    tier: 2,
    id,
    async critique(_req: ModelCriticRequest): Promise<ModelCriticResult> {
      throw new ModelCriticNotEnabledError(2, id);
    },
  };
}

/** Tier 3 stub — frontier LLM-as-judge. */
export function createTier3ModelCriticStub(id = 'critic.tier3.stub'): ModelCritic {
  return {
    tier: 3,
    id,
    async critique(_req: ModelCriticRequest): Promise<ModelCriticResult> {
      throw new ModelCriticNotEnabledError(3, id);
    },
  };
}
