import type {
  AgentEvent,
  AgentTodo,
  HostToWebviewMessage,
  McpServerView,
  PersistedChatTurn,
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
  private readonly thinkingCoalescer: TokenDeltaCoalescer;
  private disposed = false;

  constructor(private readonly post: PostToWebview) {
    this.coalescer = new TokenDeltaCoalescer((text) => {
      if (this.disposed) return;
      this.post({ type: 'TOKEN_DELTA', text });
    }, 16);
    this.thinkingCoalescer = new TokenDeltaCoalescer((text) => {
      if (this.disposed) return;
      this.post({ type: 'THINKING_DELTA', text });
    }, 32);
  }

  private postOpaqueThinking(): void {
    if (this.disposed) return;
    this.thinkingCoalescer.flushNow();
    this.post({ type: 'THINKING_DELTA', text: '', opaque: true });
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
      case 'thinking_delta':
        if (event.opaque) {
          this.postOpaqueThinking();
          return;
        }
        if (event.text) this.thinkingCoalescer.push(event.text);
        return;
      case 'phase':
        this.coalescer.flushNow();
        this.thinkingCoalescer.flushNow();
        this.post({ type: 'PHASE', phase: event.phase });
        return;
      case 'tool_card':
        this.coalescer.flushNow();
        this.thinkingCoalescer.flushNow();
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
        this.thinkingCoalescer.flushNow();
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
          question: r.question,
          options: r.options,
          allowFreeText: r.allowFreeText,
        });
        return;
      }
      case 'subagent':
        this.coalescer.flushNow();
        this.thinkingCoalescer.flushNow();
        this.post({
          type: 'SUBAGENT',
          id: event.id,
          name: event.name,
          status: event.status,
          summary: event.summary,
        });
        return;
      case 'todos':
        this.coalescer.flushNow();
        this.thinkingCoalescer.flushNow();
        this.post({ type: 'TODOS', todos: event.todos });
        return;
      case 'done':
        this.coalescer.flushNow();
        this.thinkingCoalescer.flushNow();
        this.post({
          type: 'DONE',
          reason: event.reason,
          canContinue: event.canContinue,
          turnId: event.turnId,
        });
        return;
      case 'error':
        this.coalescer.flushNow();
        this.thinkingCoalescer.flushNow();
        this.post({
          type: 'ERROR',
          message: event.message,
          fatal: event.fatal !== false,
        });
        return;
      case 'warning':
        this.coalescer.flushNow();
        this.thinkingCoalescer.flushNow();
        this.post({ type: 'WARNING', message: event.message });
        return;
      case 'cache_usage':
        this.coalescer.flushNow();
        this.thinkingCoalescer.flushNow();
        this.post({
          type: 'CACHE_USAGE',
          cacheReadInputTokens: event.cacheReadInputTokens,
          cacheWriteInputTokens: event.cacheWriteInputTokens,
        });
        return;
      case 'telemetry':
        this.coalescer.flushNow();
        this.thinkingCoalescer.flushNow();
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
    mcpServers?: McpServerView[];
    mcpStdioAllowed?: boolean;
    bedrockConfigured?: boolean;
    bedrockModelId?: string;
    bedrockRegion?: string;
    reasoningEffort?: string;
    ccloudConfigured?: boolean;
    telemetry?: Record<string, number>;
    signedIn?: boolean;
    linkedProjectId?: string | null;
    linkedProjectName?: string | null;
    todos?: AgentTodo[];
    hasSession?: boolean;
    uiTurns?: PersistedChatTurn[];
  }): void {
    this.coalescer.flushNow();
    this.post({
      type: 'STATE_SNAPSHOT',
      trusted: params.trusted,
      streaming: params.streaming,
      transcript: params.transcript,
      autonomy: params.autonomy,
      pendingApproval: params.pendingApproval,
      mcpConfigured: params.mcpConfigured,
      mcpServers: params.mcpServers,
      mcpStdioAllowed: params.mcpStdioAllowed,
      bedrockConfigured: params.bedrockConfigured,
      bedrockModelId: params.bedrockModelId,
      bedrockRegion: params.bedrockRegion,
      reasoningEffort: params.reasoningEffort,
      ccloudConfigured: params.ccloudConfigured,
      telemetry: params.telemetry,
      signedIn: params.signedIn,
      linkedProjectId: params.linkedProjectId,
      linkedProjectName: params.linkedProjectName,
      todos: params.todos,
      hasSession: params.hasSession,
      uiTurns: params.uiTurns,
    });
  }

  postError(message: string): void {
    this.coalescer.flushNow();
    this.thinkingCoalescer.flushNow();
    this.post({ type: 'ERROR', message });
  }

  postWarning(message: string): void {
    this.coalescer.flushNow();
    this.thinkingCoalescer.flushNow();
    this.post({ type: 'WARNING', message });
  }

  dispose(): void {
    // Flush buffered tokens while still accepting posts, then seal.
    this.coalescer.dispose();
    this.thinkingCoalescer.dispose();
    this.disposed = true;
  }
}
