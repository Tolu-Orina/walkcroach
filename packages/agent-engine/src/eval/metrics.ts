/**
 * P5 — Dashboard metric *concepts* for IDE / telemetry (names only).
 * Wiring into live SLIs is a follow-up; trajectory goldens assert soft caps.
 */

export const TRAJECTORY_METRIC_IDS = [
  'wrong_tool',
  'edit_mismatch',
  'thrash',
  'verify_pass',
  'turns_to_done',
] as const;

export type TrajectoryMetricId = (typeof TRAJECTORY_METRIC_IDS)[number];

export const TRAJECTORY_METRIC_DOCS: Record<
  TrajectoryMetricId,
  { label: string; source: string }
> = {
  wrong_tool: {
    label: 'Wrong-tool / off-allowlist attempts',
    source: 'phase remask schema + tool dispatch errors',
  },
  edit_mismatch: {
    label: 'edit_mismatch / path-gate failures',
    source: 'classifyPhaseFailure / edit-path-mismatch-guard',
  },
  thrash: {
    label: 'Thrash warn/escalate events',
    source: 'walkcroach.thrash.* telemetry',
  },
  verify_pass: {
    label: 'Mutating runs that finish verified',
    source: 'done.reason !== unverified when recipes exist',
  },
  turns_to_done: {
    label: 'Parent converse turns until done',
    source: 'streamConverseTurn call count',
  },
};

/** Documented readiness for engine-wide default-on (now shipped). */
export const PHASE_GRAPH_DEFAULT_ON_GATE = {
  enginePhaseGraphStillOptIn: false,
  enginePhaseGraphDefaultOn: true,
  ideDefaultsOn: [
    'walkcroach.ide.phaseGraph',
    'walkcroach.ide.forcePlanOnRisk',
    'walkcroach.ide.architectureCritic',
    'walkcroach.ide.toolRank',
  ] as const,
  requiredGreen: ['npm run eval', 'npm run test:fitness'] as const,
};
