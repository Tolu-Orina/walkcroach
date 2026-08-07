/**
 * Adapter from `@walkcroach/sdk` onto the shape first-party coding hosts inject
 * into `@walkcroach/agent-engine` (`ProjectMemoryBridge`).
 *
 * Phase P2: IDE / CLI / Desktop stop hand-rolling `/ide/v1/memory/*` and share
 * one remember/recall/list contract with the public SDK.
 */
import { WalkCroach } from './index.js';
import { normalizeMemoryKind, type MemoryKind } from './vendor/memory-contracts/index.js';

export type HostMemoryHit = {
  id: string;
  kind: string;
  text: string;
  /** Cosine distance 0–2 when relevance was available; omitted otherwise. */
  distance?: number;
  sourceSurface?: string;
};

export type HostMemoryBridge = {
  projectId: string;
  projectName?: string;
  recall(params: {
    query: string;
    limit?: number;
    sourceSurfaces?: string[];
  }): Promise<HostMemoryHit[]>;
  mirror(params: {
    text: string;
    kind?: string;
  }): Promise<{ id: string; supersededId?: string | null }>;
  listEntries?(params?: {
    limit?: number;
    sourceSurfaces?: string[];
  }): Promise<
    Array<{
      id: string;
      kind: string;
      text: string;
      sourceSurface: string;
      createdAt: string;
    }>
  >;
};

function asKind(raw: string | undefined): MemoryKind {
  return normalizeMemoryKind(raw, 'decision');
}

/** relevance 0..1 → approximate cosine distance 0..2 (inverse of server map). */
function relevanceToDistance(relevance: number | null): number | undefined {
  if (relevance === null || !Number.isFinite(relevance)) return undefined;
  return Number(((1 - relevance) * 2).toFixed(4));
}

export function createHostMemoryBridge(opts: {
  getAccessToken: () => Promise<string | undefined>;
  projectId: string;
  projectName?: string;
  /** Recorded as `source_surface` on remember — ide | cli | desktop. */
  surface: string;
  /**
   * API host without a trailing slash. May or may not already end in `/v1`
   * (SDK paths are `/v1/memory/…` relative to this host).
   */
  getBaseUrl: () => string | Promise<string>;
  fetch?: typeof globalThis.fetch;
}): HostMemoryBridge {
  async function client(): Promise<WalkCroach> {
    const token = await opts.getAccessToken();
    if (!token) {
      throw new Error('Not signed in — project memory requires a Cognito token.');
    }
    const baseUrl = await opts.getBaseUrl();
    return new WalkCroach({
      accessToken: token,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      fetch: opts.fetch,
    });
  }

  return {
    projectId: opts.projectId,
    projectName: opts.projectName,
    async recall({ query, limit, sourceSurfaces }) {
      const wc = await client();
      const hits = await wc.memory.recall({
        projectId: opts.projectId,
        query,
        limit,
        surfaces: sourceSurfaces,
      });
      return hits.map((h) => ({
        id: h.id,
        kind: h.kind,
        text: h.text,
        sourceSurface: h.surface,
        distance: relevanceToDistance(h.relevance),
      }));
    },
    async mirror({ text, kind }) {
      const wc = await client();
      const result = await wc.memory.remember({
        projectId: opts.projectId,
        text,
        kind: asKind(kind),
        surface: opts.surface,
      });
      return { id: result.id, supersededId: result.supersededId };
    },
    async listEntries({ limit, sourceSurfaces } = {}) {
      const wc = await client();
      const entries = await wc.memory.list({
        projectId: opts.projectId,
        limit,
        surfaces: sourceSurfaces,
      });
      return entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        text: e.text,
        sourceSurface: e.surface,
        createdAt: e.createdAt,
      }));
    },
  };
}
