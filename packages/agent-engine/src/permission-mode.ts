/**
 * Claude-style permission mode vocabulary (Pre–Phase 6).
 *
 * Aliases over existing AutonomyLevel + plan/readOnly — does not wrap the
 * Claude Agent SDK. Hard gates (infra / critical / MCP writes) still apply
 * even under `bypassPermissions`.
 */

import type { AutonomyLevel } from './approvals.js';

/**
 * Claude Agent SDK–inspired names:
 * - default → strict autonomy
 * - acceptEdits → low_friction (routine local edits/commands)
 * - bypassPermissions → low_friction + host may skip confirm UI (gates remain)
 * - plan → read-only / plan mode (no mutating tools)
 */
export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan';

export type PermissionResolved = {
  mode: PermissionMode;
  autonomy: AutonomyLevel;
  /** When true, loop should run in plan/readOnly. */
  readOnly: boolean;
  /**
   * Host hint: skip interactive confirm when auto-approve already allows.
   * Never disables isCriticalCommand / infra ToolDef gates.
   */
  skipInteractiveConfirm: boolean;
};

export function resolvePermissionMode(
  mode: PermissionMode | undefined,
  fallback: AutonomyLevel = 'strict',
): PermissionResolved {
  switch (mode) {
    case 'plan':
      return {
        mode: 'plan',
        autonomy: 'strict',
        readOnly: true,
        skipInteractiveConfirm: false,
      };
    case 'acceptEdits':
      return {
        mode: 'acceptEdits',
        autonomy: 'low_friction',
        readOnly: false,
        skipInteractiveConfirm: false,
      };
    case 'bypassPermissions':
      return {
        mode: 'bypassPermissions',
        autonomy: 'low_friction',
        readOnly: false,
        skipInteractiveConfirm: true,
      };
    case 'default':
    case undefined:
    default:
      return {
        mode: 'default',
        autonomy: fallback === 'low_friction' ? 'low_friction' : 'strict',
        readOnly: false,
        skipInteractiveConfirm: false,
      };
  }
}

export function permissionModeFromAutonomy(
  autonomy: AutonomyLevel,
  readOnly?: boolean,
): PermissionMode {
  if (readOnly) return 'plan';
  if (autonomy === 'low_friction') return 'acceptEdits';
  return 'default';
}
