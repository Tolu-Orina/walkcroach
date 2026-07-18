/**
 * Closed webview ↔ host message allowlist (IDE PRD / impl plan §8.2).
 * Reject unknown types at the bridge. Extended deliberately for Phase A approvals.
 */

export const WEBVIEW_TO_HOST = [
  'READY',
  'SUBMIT_TASK',
  'APPROVE_STEP',
  'REJECT_STEP',
  'SET_AUTONOMY',
  'CANCEL',
] as const;

export const HOST_TO_WEBVIEW = [
  'TOKEN_DELTA',
  'TOOL_CARD',
  'PHASE',
  'SUBAGENT',
  'DONE',
  'ERROR',
  'WARNING',
  'STATE_SNAPSHOT',
  'APPROVAL_REQUEST',
  'CACHE_USAGE',
  'TELEMETRY',
] as const;

export type WebviewToHostType = (typeof WEBVIEW_TO_HOST)[number];
export type HostToWebviewType = (typeof HOST_TO_WEBVIEW)[number];

export type AutonomyLevelMsg = 'strict' | 'low_friction';

export type WebviewToHostMessage =
  | { type: 'READY' }
  | { type: 'SUBMIT_TASK'; text: string; mode?: 'plan' | 'act' }
  | { type: 'APPROVE_STEP'; stepId: string }
  | { type: 'REJECT_STEP'; stepId: string }
  | { type: 'SET_AUTONOMY'; level: AutonomyLevelMsg }
  | { type: 'CANCEL' };

export type HostToWebviewMessage =
  | { type: 'TOKEN_DELTA'; text: string }
  | {
      type: 'TOOL_CARD';
      id: string;
      name: string;
      status: 'pending' | 'running' | 'done' | 'error';
      detail?: string;
    }
  | { type: 'PHASE'; phase: 'gather' | 'act' | 'verify' }
  | {
      type: 'SUBAGENT';
      id: string;
      name: string;
      status: 'running' | 'done' | 'error';
      summary?: string;
    }
  | { type: 'DONE'; reason: string }
  | { type: 'ERROR'; message: string; fatal?: boolean }
  | { type: 'WARNING'; message: string }
  | {
      type: 'APPROVAL_REQUEST';
      stepId: string;
      kind: 'diff' | 'command';
      toolName: string;
      path?: string;
      before?: string;
      after?: string;
      cmd?: string;
    }
  | {
      type: 'CACHE_USAGE';
      cacheReadInputTokens: number;
      cacheWriteInputTokens: number;
    }
  | {
      type: 'TELEMETRY';
      name: string;
      counters?: Record<string, number>;
      detail?: string;
    }
  | {
      type: 'STATE_SNAPSHOT';
      trusted: boolean;
      streaming: boolean;
      transcript: string;
      autonomy: AutonomyLevelMsg;
      pendingApproval: {
        stepId: string;
        kind: 'diff' | 'command';
        toolName: string;
        path?: string;
        before?: string;
        after?: string;
        cmd?: string;
      } | null;
      mcpConfigured?: boolean;
      telemetry?: Record<string, number>;
      signedIn?: boolean;
      linkedProjectId?: string | null;
      linkedProjectName?: string | null;
    };

export function isWebviewToHostType(value: unknown): value is WebviewToHostType {
  return (
    typeof value === 'string' &&
    (WEBVIEW_TO_HOST as readonly string[]).includes(value)
  );
}

export function parseWebviewToHostMessage(
  raw: unknown,
): WebviewToHostMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Record<string, unknown>;
  if (!isWebviewToHostType(msg.type)) return null;

  switch (msg.type) {
    case 'READY':
      return { type: 'READY' };
    case 'SUBMIT_TASK':
      if (typeof msg.text !== 'string') return null;
      if (
        msg.mode !== undefined &&
        msg.mode !== 'plan' &&
        msg.mode !== 'act'
      ) {
        return null;
      }
      return {
        type: 'SUBMIT_TASK',
        text: msg.text,
        mode: msg.mode,
      };
    case 'APPROVE_STEP':
    case 'REJECT_STEP':
      if (typeof msg.stepId !== 'string') return null;
      return { type: msg.type, stepId: msg.stepId };
    case 'SET_AUTONOMY':
      if (msg.level !== 'strict' && msg.level !== 'low_friction') return null;
      return { type: 'SET_AUTONOMY', level: msg.level };
    case 'CANCEL':
      return { type: 'CANCEL' };
    default:
      return null;
  }
}
