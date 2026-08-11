/**
 * P5 — Recorded golden trajectories for phase-graph remask.
 */

import type { TrajectoryGolden } from '../trajectory.js';

/** Non-trivial gather → act write; writers absent in Gather. */
export const TRAJECTORY_GATHER_THEN_ACT: TrajectoryGolden = {
  id: 'gather-then-act-write',
  prompt:
    'Refactor the auth and session modules across the codebase so login shares one session helper. Explore first, then implement.',
  loop: {
    phaseGraphEnabled: true,
    forcePlanOnRisk: false,
    architectureCriticEnabled: false,
    toolRankEnabled: false,
    includePhaseB: false,
    subagentsEnabled: false,
    maxIterations: 16,
    actionBias: 'always',
  },
  workspace: {
    files: {
      'src/auth.ts': 'export function login() { return true; }\n',
    },
  },
  script: [
    {
      toolUses: [
        {
          name: 'read_file',
          input: { path: 'src/auth.ts' },
        },
      ],
    },
    // Gather end-turn → Act
    { text: 'Enough context.', stopReason: 'end_turn' },
    {
      toolUses: [
        {
          name: 'write_file',
          input: {
            path: 'src/session-util.ts',
            content: 'export const sessionKey = "wc";\n',
          },
        },
      ],
    },
    { text: 'Added session util.', stopReason: 'end_turn' },
    // Soft todo nudge end
    { text: 'Todos updated.', stopReason: 'end_turn' },
    // Legacy verify-review
    { text: 'REVIEW_OK\nLooks coherent.', stopReason: 'end_turn' },
  ],
  expect: {
    startPhase: 'gather',
    phaseSequenceIncludes: ['gather', 'act'],
    turns: [
      {
        converseIndex: 0,
        phase: 'gather',
        toolsMustInclude: ['read_file', 'search'],
        toolsMustExclude: ['write_file', 'edit_file', 'apply_patch'],
      },
      {
        converseIndex: 2,
        phase: 'act',
        toolsMustInclude: ['write_file', 'edit_file'],
        toolsMustExclude: [],
      },
    ],
    doneReason: 'end_turn',
    filesContain: [
      { path: 'src/session-util.ts', includes: 'sessionKey' },
    ],
    metrics: { maxTurns: 12, verifyPass: true },
  },
};

/** Mutating work + verify recipe → verify tool → not unverified. */
export const TRAJECTORY_VERIFY_PASS: TrajectoryGolden = {
  id: 'verify-required-pass',
  prompt: 'fix typo in x.ts',
  loop: {
    phaseGraphEnabled: true,
    forcePlanOnRisk: false,
    architectureCriticEnabled: false,
    toolRankEnabled: false,
    includePhaseB: false,
    subagentsEnabled: false,
    maxIterations: 16,
    actionBias: 'always',
  },
  workspace: {
    files: {
      'x.ts': 'export const nme = 1;\n',
    },
    verifyJson: { commands: ['echo ok'], cwd: '.' },
    settingsJson: {
      verify: { required: true, maxNudges: 1 },
    },
  },
  script: [
    {
      toolUses: [
        {
          name: 'write_file',
          input: { path: 'x.ts', content: 'export const name = 1;\n' },
        },
      ],
    },
    {
      toolUses: [
        {
          name: 'verify',
          input: { command: 'echo ok' },
        },
      ],
    },
    { text: 'Verified.', stopReason: 'end_turn' },
    { text: 'REVIEW_OK\nVerified.', stopReason: 'end_turn' },
  ],
  expect: {
    startPhase: 'act',
    turns: [
      {
        converseIndex: 0,
        phase: 'act',
        toolsMustInclude: ['write_file', 'verify'],
      },
    ],
    doneReason: 'end_turn',
    filesContain: [{ path: 'x.ts', includes: 'export const name' }],
    metrics: { verifyPass: true, maxTurns: 12 },
  },
};

export const TRAJECTORY_IDS = [
  TRAJECTORY_GATHER_THEN_ACT.id,
  TRAJECTORY_VERIFY_PASS.id,
] as const;

export const ALL_TRAJECTORY_GOLDENS: TrajectoryGolden[] = [
  TRAJECTORY_GATHER_THEN_ACT,
  TRAJECTORY_VERIFY_PASS,
];
