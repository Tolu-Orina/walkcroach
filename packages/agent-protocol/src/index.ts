/**
 * Shared Desktop agent-ui ↔ workbench message contract (P3.9).
 *
 * Single source for PROTOCOL_VERSION and approval binding. Desktop
 * `packages/agent-ui` re-exports from here (file: dependency) so fleet
 * sessionId cannot drift between UI and host.
 *
 * Bump PROTOCOL_VERSION on any breaking change to HostMessage | ViewMessage.
 */
export const PROTOCOL_VERSION = 4;

export type AgentMode = 'chat' | 'plan' | 'agent';
export type AgentPhase = 'idle' | 'gather' | 'act' | 'verify';
export type MemorySurface = 'web' | 'chrome' | 'ide' | 'cli' | 'desktop';
export type TurnRole = 'user' | 'assistant' | 'system' | 'tool';
export type ApprovalState = 'pending' | 'approved' | 'declined' | 'failed';
export type FleetSessionStatus = 'idle' | 'running' | 'error';
export type FleetLayout = 'tabs' | 'grid';

export interface Provenance {
  readonly surface: MemorySurface;
  readonly ts: number;
  readonly label?: string;
}

export interface Turn {
  readonly id: string;
  readonly role: TurnRole;
  readonly text: string;
  readonly ts: number;
  readonly mode?: AgentMode;
  readonly provenance?: readonly Provenance[];
  readonly streaming?: boolean;
}

export interface ApprovalRequest {
  readonly stepId: string;
  /** Fleet member id — required for parallel sessions (P3.2). */
  readonly sessionId?: string;
  readonly kind: 'diff' | 'command';
  readonly title: string;
  readonly detail: string;
  readonly path?: string;
  readonly cmd?: string;
  /** Diff preview (kind === 'diff') — truncated for the wire. */
  readonly before?: string;
  readonly after?: string;
  readonly state: ApprovalState;
}

export interface AuthState {
  readonly signedIn: boolean;
  readonly linkedProjectId?: string;
  readonly linkedProjectName?: string;
}

export interface BrandColors {
  readonly signal: string;
  readonly teal: string;
  readonly ember: string;
}

export interface FleetSession {
  readonly id: string;
  readonly title: string;
  readonly status: FleetSessionStatus;
  readonly phase: AgentPhase;
  readonly ahpSession?: string;
  readonly worktreeBranch?: string;
  readonly preview?: string;
  readonly createdAt: number;
}

export interface SoftCapNotice {
  readonly count: number;
  readonly cap: number;
  readonly remaining: number;
}

export interface AgentSnapshot {
  readonly mode: AgentMode;
  readonly phase: AgentPhase;
  readonly auth: AuthState;
  readonly turns: readonly Turn[];
  readonly approvals: readonly ApprovalRequest[];
  readonly ahpSession?: string;
  readonly model?: string;
  readonly isMac: boolean;
  readonly brand: BrandColors;
  readonly fleetSessions?: readonly FleetSession[];
  readonly activeFleetId?: string;
  readonly fleetSoftCap?: number;
  readonly fleetLayout?: FleetLayout;
  readonly surface?: 'aux' | 'agentsWindow';
  readonly softCapNotice?: SoftCapNotice;
}

/** workbench -> webview */
export type HostMessage =
  | { readonly type: 'init'; readonly version: number; readonly snapshot: AgentSnapshot }
  | { readonly type: 'state'; readonly snapshot: AgentSnapshot };

/** webview -> workbench */
export type ViewMessage =
  | { readonly type: 'ready'; readonly version: number }
  | { readonly type: 'submit'; readonly prompt: string }
  | { readonly type: 'cancel' }
  | { readonly type: 'setMode'; readonly mode: AgentMode }
  | { readonly type: 'setModel'; readonly model: string }
  | {
      readonly type: 'resolveApproval';
      readonly stepId: string;
      readonly decision: 'approve' | 'reject';
      /** Must match ApprovalRequest.sessionId when fleet is active. */
      readonly sessionId?: string;
    }
  | { readonly type: 'openDiff'; readonly path: string; readonly before: string; readonly after: string }
  | { readonly type: 'signIn' }
  | { readonly type: 'openProvenance'; readonly surface: MemorySurface; readonly ts: number }
  | { readonly type: 'setBrand'; readonly brand: BrandColors }
  | { readonly type: 'selectFleetSession'; readonly id: string }
  | { readonly type: 'newFleetSession'; readonly title?: string; readonly force?: boolean }
  | { readonly type: 'killFleetSession'; readonly id: string }
  | {
      readonly type: 'launchFleet';
      readonly tasks: readonly { title: string; prompt: string; isolate?: boolean }[];
      readonly force?: boolean;
    }
  | { readonly type: 'setFleetLayout'; readonly layout: FleetLayout }
  | { readonly type: 'openAgentsWindow' };
