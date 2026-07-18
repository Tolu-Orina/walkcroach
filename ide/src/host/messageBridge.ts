import type {
  AgentEvent,
  HostToWebviewMessage,
} from '@walkcroach/agent-engine';
import {
  TokenDeltaCoalescer,
  parseWebviewToHostMessage,
  type WebviewToHostMessage,
} from '@walkcroach/agent-engine';

export type PostToWebview = (msg: HostToWebviewMessage) => void;

/**
 * Maps engine AgentEvents → protocol messages with TOKEN_DELTA coalescing (~16ms).
 */
export class MessageBridge {
  private readonly coalescer: TokenDeltaCoalescer;
  private disposed = false;

  constructor(private readonly post: PostToWebview) {
    this.coalescer = new TokenDeltaCoalescer((text) => {
      if (this.disposed) return;
      this.post({ type: 'TOKEN_DELTA', text });
    }, 16);
  }

  parseIncoming(raw: unknown): WebviewToHostMessage | null {
    return parseWebviewToHostMessage(raw);
  }

  onAgentEvent(event: AgentEvent): void {
    if (this.disposed) return;

    switch (event.type) {
      case 'token_delta':
        this.coalescer.push(event.text);
        return;
      case 'phase':
        this.coalescer.flushNow();
        this.post({ type: 'PHASE', phase: event.phase });
        return;
      case 'tool_card':
        this.coalescer.flushNow();
        this.post({
          type: 'TOOL_CARD',
          id: event.id,
          name: event.name,
          status: event.status,
          detail: event.detail,
        });
        return;
      case 'approval_request': {
        this.coalescer.flushNow();
        const r = event.request;
        this.post({
          type: 'APPROVAL_REQUEST',
          stepId: r.stepId,
          kind: r.kind,
          toolName: r.toolName,
          path: r.path,
          before: r.before,
          after: r.after,
          cmd: r.cmd,
        });
        return;
      }
      case 'subagent':
        this.coalescer.flushNow();
        this.post({
          type: 'SUBAGENT',
          id: event.id,
          name: event.name,
          status: event.status,
          summary: event.summary,
        });
        return;
      case 'done':
        this.coalescer.flushNow();
        this.post({ type: 'DONE', reason: event.reason });
        return;
      case 'error':
        this.coalescer.flushNow();
        this.post({
          type: 'ERROR',
          message: event.message,
          fatal: event.fatal !== false,
        });
        return;
      case 'warning':
        this.coalescer.flushNow();
        this.post({ type: 'WARNING', message: event.message });
        return;
      case 'cache_usage':
        this.coalescer.flushNow();
        this.post({
          type: 'CACHE_USAGE',
          cacheReadInputTokens: event.cacheReadInputTokens,
          cacheWriteInputTokens: event.cacheWriteInputTokens,
        });
        return;
      case 'telemetry':
        this.coalescer.flushNow();
        this.post({
          type: 'TELEMETRY',
          name: event.name,
          counters: event.counters,
          detail: event.detail,
        });
        return;
      default:
        return;
    }
  }

  postSnapshot(params: {
    trusted: boolean;
    streaming: boolean;
    transcript: string;
    autonomy: 'strict' | 'low_friction';
    pendingApproval: Extract<
      HostToWebviewMessage,
      { type: 'APPROVAL_REQUEST' }
    > | null;
    mcpConfigured?: boolean;
    telemetry?: Record<string, number>;
    signedIn?: boolean;
    linkedProjectId?: string | null;
    linkedProjectName?: string | null;
  }): void {
    // Flush pending token deltas before snapshot so transcript is not duplicated.
    this.coalescer.flushNow();
    this.post({
      type: 'STATE_SNAPSHOT',
      trusted: params.trusted,
      streaming: params.streaming,
      transcript: params.transcript,
      autonomy: params.autonomy,
      pendingApproval: params.pendingApproval,
      mcpConfigured: params.mcpConfigured,
      telemetry: params.telemetry,
      signedIn: params.signedIn,
      linkedProjectId: params.linkedProjectId,
      linkedProjectName: params.linkedProjectName,
    });
  }

  postError(message: string): void {
    this.coalescer.flushNow();
    this.post({ type: 'ERROR', message });
  }

  dispose(): void {
    this.disposed = true;
    this.coalescer.dispose();
  }
}
