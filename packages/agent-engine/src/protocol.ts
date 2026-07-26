/**
 * Closed webview ↔ host message allowlist (IDE PRD / impl plan §8.2).
 * Reject unknown types at the bridge. Extended deliberately for Phase A approvals.
 */

export const WEBVIEW_TO_HOST = [
  'READY',
  'SUBMIT_TASK',
  'APPROVE_STEP',
  'REJECT_STEP',
  'ANSWER_QUESTION',
  'SET_AUTONOMY',
  'CANCEL',
  'SIGN_IN',
  'SAVE_SETTINGS',
  'CONTINUE_TASK',
  'CLEAR_SESSION',
  'REVERT_TO_TURN',
  'SYNC_UI_TURNS',
] as const;

export const HOST_TO_WEBVIEW = [
  'TOKEN_DELTA',
  'TOOL_CARD',
  'PHASE',
  'SUBAGENT',
  'TODOS',
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

/**
 * A pasted/attached chat attachment. Text-like files carry `contentText`
 * (UTF-8); images and other binary documents carry `contentBase64` (raw
 * base64, no `data:` prefix). At least one of the two must be present.
 */
export type SubmitAttachment = {
  id: string;
  name: string;
  mime: string;
  contentText?: string;
  contentBase64?: string;
};

/** Slim chat bubble persisted for reload (no attachment bytes / preview URLs). */
export type PersistedChatTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  mode?: 'plan' | 'act';
  tools?: Array<{
    id: string;
    name: string;
    status: 'pending' | 'running' | 'done' | 'error';
    detail?: string;
  }>;
  subagents?: Array<{
    id: string;
    name: string;
    status: 'running' | 'done' | 'error';
    summary?: string;
  }>;
  stopReason?: string;
  canContinue?: boolean;
  turnId?: string;
  attachments?: Array<{ id: string; name: string; mime: string }>;
};

export type WebviewToHostMessage =
  | { type: 'READY' }
  | {
      type: 'SUBMIT_TASK';
      text: string;
      mode?: 'plan' | 'act';
      attachments?: SubmitAttachment[];
    }
  | { type: 'APPROVE_STEP'; stepId: string }
  | { type: 'REJECT_STEP'; stepId: string }
  | {
      type: 'ANSWER_QUESTION';
      stepId: string;
      selected: string;
      freeText?: string;
    }
  | { type: 'SET_AUTONOMY'; level: AutonomyLevelMsg }
  | { type: 'CANCEL' }
  | { type: 'SIGN_IN' }
  | {
      type: 'SAVE_SETTINGS';
      /** Set to store; empty string ignored; null clears. */
      bedrockApiKey?: string | null;
      /** Optional Bedrock model ID override; null clears to default. */
      bedrockModelId?: string | null;
      /** Extended-thinking tier override; null clears to default (medium). */
      reasoningEffort?: 'off' | 'low' | 'medium' | 'high' | null;
      mcpClusterId?: string;
      mcpApiKey?: string;
      mcpUrl?: string;
      ccloudApiKey?: string | null;
      mcpSnippet?: string;
      clearMcp?: boolean;
    }
  | { type: 'CONTINUE_TASK' }
  | { type: 'CLEAR_SESSION' }
  | { type: 'REVERT_TO_TURN'; turnId: string }
  | { type: 'SYNC_UI_TURNS'; turns: PersistedChatTurn[] };

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
  | {
      type: 'TODOS';
      todos: Array<{
        id: string;
        content: string;
        status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
      }>;
    }
  | {
      type: 'DONE';
      reason: string;
      canContinue?: boolean;
      /** P2 checkpoints — this turn's id, for "revert to before this turn". */
      turnId?: string;
    }
  | { type: 'ERROR'; message: string; fatal?: boolean }
  | { type: 'WARNING'; message: string }
  | {
      type: 'APPROVAL_REQUEST';
      stepId: string;
      kind: 'diff' | 'command' | 'question';
      toolName: string;
      path?: string;
      before?: string;
      after?: string;
      cmd?: string;
      question?: string;
      options?: string[];
      allowFreeText?: boolean;
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
        kind: 'diff' | 'command' | 'question';
        toolName: string;
        path?: string;
        before?: string;
        after?: string;
        cmd?: string;
        question?: string;
        options?: string[];
        allowFreeText?: boolean;
      } | null;
      mcpConfigured?: boolean;
      bedrockConfigured?: boolean;
      bedrockModelId?: string;
      reasoningEffort?: string;
      ccloudConfigured?: boolean;
      telemetry?: Record<string, number>;
      signedIn?: boolean;
      linkedProjectId?: string | null;
      linkedProjectName?: string | null;
      todos?: Array<{
        id: string;
        content: string;
        status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
      }>;
      hasSession?: boolean;
      /** Restored chat bubbles (tool cards, turnIds) after reload. */
      uiTurns?: PersistedChatTurn[];
    };

export function isWebviewToHostType(value: unknown): value is WebviewToHostType {
  return (
    typeof value === 'string' &&
    (WEBVIEW_TO_HOST as readonly string[]).includes(value)
  );
}

const TOOL_STATUSES = new Set(['pending', 'running', 'done', 'error']);
const SUB_STATUSES = new Set(['running', 'done', 'error']);

export function parsePersistedChatTurns(raw: unknown): PersistedChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: PersistedChatTurn[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const t = row as Record<string, unknown>;
    if (typeof t.id !== 'string' || !t.id) continue;
    if (t.role !== 'user' && t.role !== 'assistant') continue;
    if (typeof t.text !== 'string') continue;
    const turn: PersistedChatTurn = {
      id: t.id,
      role: t.role,
      text: t.text,
    };
    if (t.mode === 'plan' || t.mode === 'act') turn.mode = t.mode;
    if (typeof t.stopReason === 'string') turn.stopReason = t.stopReason;
    if (typeof t.canContinue === 'boolean') turn.canContinue = t.canContinue;
    if (typeof t.turnId === 'string' && t.turnId) turn.turnId = t.turnId;
    if (Array.isArray(t.tools)) {
      const tools: NonNullable<PersistedChatTurn['tools']> = [];
      for (const tool of t.tools) {
        if (!tool || typeof tool !== 'object') continue;
        const g = tool as Record<string, unknown>;
        if (typeof g.id !== 'string' || typeof g.name !== 'string') continue;
        if (typeof g.status !== 'string' || !TOOL_STATUSES.has(g.status)) {
          continue;
        }
        tools.push({
          id: g.id,
          name: g.name,
          status: g.status as NonNullable<
            PersistedChatTurn['tools']
          >[number]['status'],
          detail: typeof g.detail === 'string' ? g.detail : undefined,
        });
      }
      if (tools.length) turn.tools = tools;
    }
    if (Array.isArray(t.subagents)) {
      const subagents: NonNullable<PersistedChatTurn['subagents']> = [];
      for (const sub of t.subagents) {
        if (!sub || typeof sub !== 'object') continue;
        const g = sub as Record<string, unknown>;
        if (typeof g.id !== 'string' || typeof g.name !== 'string') continue;
        if (typeof g.status !== 'string' || !SUB_STATUSES.has(g.status)) {
          continue;
        }
        subagents.push({
          id: g.id,
          name: g.name,
          status: g.status as NonNullable<
            PersistedChatTurn['subagents']
          >[number]['status'],
          summary: typeof g.summary === 'string' ? g.summary : undefined,
        });
      }
      if (subagents.length) turn.subagents = subagents;
    }
    if (Array.isArray(t.attachments)) {
      const attachments: NonNullable<PersistedChatTurn['attachments']> = [];
      for (const a of t.attachments) {
        if (!a || typeof a !== 'object') continue;
        const g = a as Record<string, unknown>;
        if (
          typeof g.id !== 'string' ||
          typeof g.name !== 'string' ||
          typeof g.mime !== 'string'
        ) {
          continue;
        }
        attachments.push({ id: g.id, name: g.name, mime: g.mime });
      }
      if (attachments.length) turn.attachments = attachments;
    }
    out.push(turn);
  }
  return out.slice(-100);
}

/** Drops malformed entries rather than rejecting the whole SUBMIT_TASK message. */
function parseSubmitAttachments(raw: unknown): SubmitAttachment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SubmitAttachment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.mime !== 'string') {
      continue;
    }
    const contentText = typeof e.contentText === 'string' ? e.contentText : undefined;
    const contentBase64 = typeof e.contentBase64 === 'string' ? e.contentBase64 : undefined;
    if (contentText === undefined && contentBase64 === undefined) continue;
    out.push({ id: e.id, name: e.name, mime: e.mime, contentText, contentBase64 });
  }
  return out.length ? out : undefined;
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
        attachments: parseSubmitAttachments(msg.attachments),
      };
    case 'APPROVE_STEP':
    case 'REJECT_STEP':
      if (typeof msg.stepId !== 'string') return null;
      return { type: msg.type, stepId: msg.stepId };
    case 'ANSWER_QUESTION':
      if (typeof msg.stepId !== 'string') return null;
      if (typeof msg.selected !== 'string') return null;
      return {
        type: 'ANSWER_QUESTION',
        stepId: msg.stepId,
        selected: msg.selected,
        freeText:
          typeof msg.freeText === 'string' ? msg.freeText : undefined,
      };
    case 'SET_AUTONOMY':
      if (msg.level !== 'strict' && msg.level !== 'low_friction') return null;
      return { type: 'SET_AUTONOMY', level: msg.level };
    case 'CANCEL':
      return { type: 'CANCEL' };
    case 'SIGN_IN':
      return { type: 'SIGN_IN' };
    case 'CONTINUE_TASK':
      return { type: 'CONTINUE_TASK' };
    case 'CLEAR_SESSION':
      return { type: 'CLEAR_SESSION' };
    case 'REVERT_TO_TURN':
      if (typeof msg.turnId !== 'string' || !msg.turnId.trim()) return null;
      return { type: 'REVERT_TO_TURN', turnId: msg.turnId };
    case 'SYNC_UI_TURNS': {
      const turns = parsePersistedChatTurns(msg.turns);
      return { type: 'SYNC_UI_TURNS', turns };
    }
    case 'SAVE_SETTINGS': {
      const out: WebviewToHostMessage = { type: 'SAVE_SETTINGS' };
      if (msg.bedrockApiKey === null) out.bedrockApiKey = null;
      else if (typeof msg.bedrockApiKey === 'string') {
        out.bedrockApiKey = msg.bedrockApiKey;
      }
      if (msg.bedrockModelId === null) out.bedrockModelId = null;
      else if (typeof msg.bedrockModelId === 'string') {
        out.bedrockModelId = msg.bedrockModelId;
      }
      if (msg.reasoningEffort === null) out.reasoningEffort = null;
      else if (
        msg.reasoningEffort === 'off' ||
        msg.reasoningEffort === 'low' ||
        msg.reasoningEffort === 'medium' ||
        msg.reasoningEffort === 'high'
      ) {
        out.reasoningEffort = msg.reasoningEffort;
      }
      if (typeof msg.mcpClusterId === 'string') {
        out.mcpClusterId = msg.mcpClusterId;
      }
      if (typeof msg.mcpApiKey === 'string') out.mcpApiKey = msg.mcpApiKey;
      if (typeof msg.mcpUrl === 'string') out.mcpUrl = msg.mcpUrl;
      if (msg.ccloudApiKey === null) out.ccloudApiKey = null;
      else if (typeof msg.ccloudApiKey === 'string') {
        out.ccloudApiKey = msg.ccloudApiKey;
      }
      if (typeof msg.mcpSnippet === 'string') out.mcpSnippet = msg.mcpSnippet;
      if (msg.clearMcp === true) out.clearMcp = true;
      return out;
    }
    default:
      return null;
  }
}
