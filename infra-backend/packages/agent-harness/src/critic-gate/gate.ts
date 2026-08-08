/**
 * CriticGate — deterministic floor with enforcement (ADR-D / Phase 4).
 *
 * Cascade: Tier 1 always → Tier 2/3 only when explicitly enabled (Phase 7).
 * Errors → revise (default) or fail; warnings alone → pass (still emitted).
 */
import type {
  CriticCheck,
  CriticCheckContext,
  CriticEnforcement,
  CriticFinding,
  CriticGateEvent,
  ModelCritic,
} from './types.js';

export type RunCriticGateParams = {
  checks: readonly CriticCheck[];
  context: CriticCheckContext;
  /**
   * When true (default), error findings yield `revise`.
   * When false, error findings yield `fail` (no revise path).
   */
  reviseOnError?: boolean;
  /** Emit findings / enforcement for agent_run_events (A6 events-first). */
  onEvent?: (event: CriticGateEvent) => void | Promise<void>;
  /**
   * Phase 7 only. Default false — model critic must not run on the floor path.
   */
  enableModelCritic?: boolean;
  modelCritic?: ModelCritic;
};

function buildRevisePrompt(errors: CriticFinding[]): string {
  const lines = [
    'CriticGate blocked the draft. Fix every error below, then resubmit.',
    '',
  ];
  for (const f of errors) {
    lines.push(
      `- [${f.rule}] ${f.message}` +
        (f.path ? ` (${f.path})` : '') +
        (f.excerpt ? ` — \`${f.excerpt}\`` : ''),
    );
  }
  return lines.join('\n');
}

async function safeEmit(
  onEvent: RunCriticGateParams['onEvent'],
  event: CriticGateEvent,
): Promise<void> {
  try {
    await onEvent?.(event);
  } catch {
    // Events must not fail the gate.
  }
}

/**
 * Run Tier-1 checks and enforce. Evaluation without this call is monitoring.
 */
export async function runCriticGate(
  params: RunCriticGateParams,
): Promise<CriticEnforcement> {
  const findings: CriticFinding[] = [];

  for (const check of params.checks) {
    if (check.tier !== 1) {
      throw new Error(
        `CriticGate Phase 4 only accepts tier-1 checks; got ${check.id} tier=${(check as CriticCheck).tier}`,
      );
    }
    const batch = await check.run(params.context);
    findings.push(...batch);
  }

  await safeEmit(params.onEvent, { type: 'critic.findings', findings: [...findings] });

  if (params.enableModelCritic) {
    if (!params.modelCritic) {
      await safeEmit(params.onEvent, {
        type: 'critic.model_skipped',
        reason: 'enableModelCritic true but no modelCritic provided',
      });
    } else {
      const model = await params.modelCritic.critique({
        artifacts: params.context.artifacts,
        floorFindings: findings,
        meta: params.context.meta,
      });
      findings.push(...model.findings);
      await safeEmit(params.onEvent, {
        type: 'critic.model_invoked',
        tier: params.modelCritic.tier,
        id: params.modelCritic.id,
        findingCount: model.findings.length,
      });
      await safeEmit(params.onEvent, {
        type: 'critic.findings',
        findings: [...model.findings],
      });
    }
  } else if (params.modelCritic) {
    await safeEmit(params.onEvent, {
      type: 'critic.model_skipped',
      reason: 'model critic present but enableModelCritic is false (Phase 7 gated)',
    });
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const reviseOnError = params.reviseOnError !== false;

  let enforcement: CriticEnforcement;
  if (errors.length === 0) {
    enforcement = { action: 'pass', findings };
  } else if (reviseOnError) {
    enforcement = {
      action: 'revise',
      findings,
      errorFindings: errors,
      revisePrompt: buildRevisePrompt(errors),
    };
  } else {
    enforcement = {
      action: 'fail',
      findings,
      errorFindings: errors,
      reason: errors.map((e) => e.message).join('; '),
    };
  }

  await safeEmit(params.onEvent, {
    type: 'critic.enforcement',
    action: enforcement.action,
    errorCount: errors.length,
  });

  return enforcement;
}

/** True when enforcement must not proceed to consumer (PR / succeed). */
export function isCriticBlocked(e: CriticEnforcement): boolean {
  return e.action === 'revise' || e.action === 'fail';
}
