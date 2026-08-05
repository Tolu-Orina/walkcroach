import { ContentApi } from './content.js';
import { createTransport, type Transport } from './http.js';
import { MemoryApi } from './memory.js';
import type { ApiKeySummary, WalkCroachConfig } from './types.js';

export class WalkCroach {
  readonly memory: MemoryApi;
  readonly content: ContentApi;
  private readonly transport: Transport;

  constructor(config: WalkCroachConfig) {
    this.transport = createTransport(config);
    this.memory = new MemoryApi(this.transport);
    this.content = new ContentApi(this.transport);
  }

  /** Liveness + advertised capabilities. Requires no credentials server-side. */
  async health(): Promise<{ ok: boolean; version: string; capabilities: string[] }> {
    return this.transport.request('GET', '/v1/health');
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
      scopes?: Array<'memory:read' | 'memory:write'>;
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

export { MemoryApi, type MemoryReader, type RecallOptions } from './memory.js';
export {
  ContentApi,
  RunHandle,
  RunFailedError,
  type PublishOptions,
} from './content.js';
export {
  WalkCroachError,
  AuthError,
  ValidationError,
  NotFoundError,
  QuotaError,
  TransientError,
  ServerError,
} from './errors.js';
export type {
  ApiKeySummary,
  ExportedEntry,
  ImportResult,
  MemoryDiff,
  MemoryEntry,
  MemoryExport,
  MemoryKind,
  PublishResult,
  PublishSource,
  RunEvent,
  RunSnapshot,
  RunStatus,
  RecallHit,
  RememberResult,
  WalkCroachConfig,
  WriteScope,
} from './types.js';
