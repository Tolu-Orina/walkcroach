import { ContentApi } from './content.js';
import { GraphsApi } from './graphs.js';
import { createTransport, type Transport } from './http.js';
import { MemoryApi } from './memory.js';
import { ProjectsApi } from './projects.js';
import type { ApiKeySummary, WalkCroachConfig } from './types.js';

export class WalkCroach {
  readonly memory: MemoryApi;
  readonly content: ContentApi;
  readonly graphs: GraphsApi;
  readonly projects: ProjectsApi;
  private readonly transport: Transport;

  constructor(config: WalkCroachConfig) {
    this.transport = createTransport(config);
    this.memory = new MemoryApi(this.transport);
    this.content = new ContentApi(this.transport);
    this.graphs = new GraphsApi(this.transport);
    this.projects = new ProjectsApi(this.transport);
  }

  /**
   * Liveness + advertised capabilities + retention window.
   * Uses `/v1/sdk-health` (not `/v1/health`) so shared API Gateway does not
   * collide with the agent smoke `GET /health`. Ide-local serves the same body
   * on both paths. Server-side auth is not required; the client still needs a
   * constructor credential today.
   */
  async health(): Promise<{
    ok: boolean;
    version: string;
    capabilities: string[];
    surface?: string;
    retention?: {
      asOfSeconds: number;
      asOfHuman: string;
      mechanism: string;
      note: string;
    };
  }> {
    return this.transport.request('GET', '/v1/sdk-health');
  }

  /**
   * API key management.
   *
   * These calls require a *user* token, not an API key: a key cannot mint or
   * revoke keys. Otherwise one leaked key could issue itself replacements and
   * survive revocation of the credential that leaked.
   */
  readonly keys = {
    create: async (opts: {
      name: string;
      scopes?: Array<'memory:read' | 'memory:write' | 'content:run'>;
      expiresInDays?: number;
    }): Promise<ApiKeySummary & { key: string; warning: string }> =>
      this.transport.request('POST', '/v1/keys', { body: opts }),

    list: async (): Promise<ApiKeySummary[]> => {
      const res = await this.transport.request<{ keys: ApiKeySummary[] }>(
        'GET',
        '/v1/keys',
      );
      return res.keys ?? [];
    },

    revoke: async (id: string): Promise<{ ok: boolean; id: string }> =>
      this.transport.request('DELETE', `/v1/keys/${encodeURIComponent(id)}`),
  };
}

export {
  PRODUCTION_API_HOST,
  PRODUCTION_API_ORIGIN,
  PRODUCTION_API_BASE_URL,
  SDK_PACKAGE_VERSION,
} from './defaults.js';
export { MemoryApi, type MemoryReader, type RecallOptions } from './memory.js';
export {
  RECALL_LIMIT_DEFAULT,
  RECALL_LIMIT_MAX,
  clampRecallLimit,
  selectHitsForPrompt,
  formatHitsForPrompt,
  type PromptHitBudget,
} from './retrieval.js';
export {
  ContentApi,
  RunHandle,
  RunFailedError,
  RunInterruptedError,
  type PublishOptions,
} from './content.js';
export {
  GraphsApi,
  type GraphsCatalog,
  type GraphsRunOptions,
  type GraphsValidateResult,
  type PublicGraphDefinition,
  type PublicGraphEdge,
  type PublicGraphNode,
} from './graphs.js';
export { ProjectsApi, type EnsuredProject } from './projects.js';
export {
  createAskUserInterrupt,
  HARNESS_PAUSE_TO_INTERRUPT,
  type InterruptKind,
  type RunInterrupt,
  type ResumeRequest,
} from './interrupt.js';
export {
  WalkCroachError,
  AuthError,
  ValidationError,
  NotFoundError,
  QuotaError,
  TransientError,
  ServerError,
} from './errors.js';
export {
  CONTENT_PUBLISH_CONTRACT_VERSION,
  GRAPH_RUN_CONTRACT_VERSION,
  RUN_PROGRESS_EVENT_TYPES,
  isRunProgressEventType,
  isStageProgressEvent,
  isCriticProgressEvent,
  isPlanProgressEvent,
  type ContentPublishContractVersion,
  type GraphRunContractVersion,
  type CriticFinding,
  type RunProgressEventType,
  type RunProgressEvent,
  type PlanApprovalPolicy,
} from './run-contract.js';
export type {
  ApiKeySummary,
  DurableRunResult,
  ExportedEntry,
  GraphRunResult,
  ImportResult,
  MemoryDiff,
  MemoryEntry,
  MemoryExport,
  MemoryKind,
  MemorySurface,
  PublishResult,
  PublishSource,
  RunEvent,
  RunSnapshot,
  RunStatus,
  RecallHit,
  RememberResult,
  SharedMemoryUiEvent,
  SupersedeWriteResult,
  WalkCroachConfig,
  WriteScope,
} from './types.js';
export {
  MEMORY_KINDS,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  EMBEDDING_DIMENSIONS,
  normalizeMemoryKind,
  isMemoryKind,
  validateExport,
  ImportFormatError,
} from './types.js';
export {
  createHostMemoryBridge,
  type HostMemoryBridge,
  type HostMemoryHit,
} from './project-memory-bridge.js';
