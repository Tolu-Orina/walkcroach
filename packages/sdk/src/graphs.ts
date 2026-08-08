/**
 * Phase 6b — public Run Graph DSL client (ADR-I).
 *
 * Platform catalog nodes only. No GraphBuilder / BYO tools / HostAdapter.
 */
import { ValidationError } from './errors.js';
import type { Transport } from './http.js';
import { RunHandle, type PublishOptions } from './content.js';
import {
  GRAPH_RUN_CONTRACT_VERSION,
  type GraphRunContractVersion,
} from './run-contract.js';
import type { RunStatus, WriteScope } from './types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PublicGraphNode = {
  id: string;
  type: string;
  config?: Record<string, unknown>;
};

export type PublicGraphEdge = {
  from: string;
  to: string | null;
  when?: string;
};

export type PublicGraphDefinition = {
  id?: string;
  entry: string;
  maxNodeExecutions: number;
  nodes: PublicGraphNode[];
  edges: PublicGraphEdge[];
};

export type GraphsCatalog = {
  contractVersion: GraphRunContractVersion | string;
  nodes: Array<{
    type: string;
    kind: string;
    description: string;
    configKeys: string[];
  }>;
  presets: Array<{ id: string; description: string }>;
  predicates: string[];
  caps: {
    maxNodeExecutions: number;
    maxNodes: number;
    maxEdges: number;
  };
  note?: string;
};

export type GraphsValidateResult =
  | {
      ok: true;
      contractVersion: string;
      needsAgent?: boolean;
      graph?: PublicGraphDefinition;
      preset?: string;
      note?: string;
    }
  | {
      ok: false;
      errors: string[];
      contractVersion?: string;
    };

export type GraphsRunOptions = {
  projectId?: string;
  /** Catalog-only graph definition. Mutually exclusive with `preset`. */
  graph?: PublicGraphDefinition;
  /** Named platform preset (v1: `content.publish`). Mutually exclusive with `graph`. */
  preset?: 'content.publish';
  input?: Record<string, unknown>;
  /** Required when the graph includes plan/draft/revise nodes. */
  writeScope?: WriteScope;
  idempotencyKey?: string;
  /** Publish fields when `preset: 'content.publish'` (same as content.publish). */
  source?: PublishOptions['source'];
  target?: PublishOptions['target'];
  instructions?: string;
  dryRun?: boolean;
  publish?: Pick<
    PublishOptions,
    'source' | 'target' | 'instructions' | 'dryRun' | 'writeScope'
  >;
};

export class GraphsApi {
  constructor(private readonly transport: Transport) {}

  /** List platform node types, presets, predicates, and caps. */
  async catalog(): Promise<GraphsCatalog> {
    return this.transport.request('GET', '/v1/graphs/catalog');
  }

  /** Fail-closed validation — rejects BYO tools / unknown types. */
  async validate(opts: {
    graph?: PublicGraphDefinition;
    preset?: 'content.publish';
  }): Promise<GraphsValidateResult> {
    if (!opts.graph && !opts.preset) {
      throw new ValidationError('graph or preset is required', 400, null, {
        field: 'graph',
      });
    }
    if (opts.graph && opts.preset) {
      throw new ValidationError('Pass either graph or preset, not both', 400, null, {
        field: 'graph',
      });
    }
    try {
      return await this.transport.request<GraphsValidateResult>(
        'POST',
        '/v1/graphs/validate',
        { body: opts },
      );
    } catch (err) {
      // Server returns 400 with { ok:false, errors } — surface as result when possible.
      if (
        err &&
        typeof err === 'object' &&
        'body' in err &&
        (err as { body?: { ok?: boolean; errors?: string[] } }).body?.ok === false
      ) {
        return (err as { body: GraphsValidateResult }).body;
      }
      throw err;
    }
  }

  /**
   * Submit a catalog graph (or content.publish preset).
   * Returns a {@link RunHandle} — same poll / wait / onProgress path as content.publish.
   */
  async run(opts: GraphsRunOptions): Promise<RunHandle> {
    if (!opts.graph && !opts.preset) {
      throw new ValidationError('graph or preset is required', 400, null, {
        field: 'graph',
      });
    }
    if (opts.graph && opts.preset) {
      throw new ValidationError('Pass either graph or preset, not both', 400, null, {
        field: 'graph',
      });
    }
    if (opts.projectId != null && opts.projectId !== '' && !UUID_RE.test(opts.projectId)) {
      throw new ValidationError('projectId must be a uuid', 400, null, {
        field: 'projectId',
      });
    }

    // Client-side BYO sniff — server is authoritative; this fails closed early.
    const blob = JSON.stringify(opts.graph ?? {});
    if (
      /"(tools|toolDefs|hostAdapter|HostAdapter|byo|customNodes)"\s*:/.test(blob)
    ) {
      throw new ValidationError(
        'BYO tools / HostAdapter are not supported on graph.run/v1 (platform catalog only)',
        400,
        null,
        { field: 'graph' },
      );
    }

    const accepted = await this.transport.request<{
      runId: string;
      status: RunStatus;
      createdAt: string;
      contractVersion?: string;
    }>('POST', '/v1/graphs/run', {
      body: {
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
        ...(opts.graph ? { graph: opts.graph } : {}),
        ...(opts.preset ? { preset: opts.preset } : {}),
        ...(opts.input ? { input: opts.input } : {}),
        ...(opts.writeScope ? { writeScope: opts.writeScope } : {}),
        ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
        ...(opts.source ? { source: opts.source } : {}),
        ...(opts.target ? { target: opts.target } : {}),
        ...(opts.instructions ? { instructions: opts.instructions } : {}),
        ...(opts.dryRun != null ? { dryRun: opts.dryRun } : {}),
        ...(opts.publish ? { publish: opts.publish } : {}),
      },
    });

    return new RunHandle(this.transport, accepted.runId, accepted.status);
  }

  /** Re-attach to a prior graph (or content) run. */
  attach(runId: string): RunHandle {
    return new RunHandle(this.transport, runId, 'queued');
  }
}

export { GRAPH_RUN_CONTRACT_VERSION };
