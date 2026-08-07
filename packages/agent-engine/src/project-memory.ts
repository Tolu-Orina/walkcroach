/**
 * Cross-surface project memory (Phase P2 / P3.4 / P4.1).
 * Engine stays free of vscode / Cognito details — host injects the bridge,
 * which should call the public `/v1/memory/*` contract via `@walkcroach/sdk`.
 *
 * Content-run workers may inject an in-process bridge that implements the same
 * shape against the DB; tools must not grow a second HTTP path inside execute.ts.
 *
 * Kinds are constrained by `@walkcroach/memory-contracts` (dual-loop SoR).
 */
import type { MemoryKind } from '@walkcroach/memory-contracts';

export type ProjectMemoryHit = {
  id: string;
  kind: MemoryKind | string;
  text: string;
  distance?: number;
  sourceSurface?: string;
};

export type ProjectMemoryBridge = {
  projectId: string;
  projectName?: string;
  recall(params: {
    query: string;
    limit?: number;
    sourceSurfaces?: string[];
  }): Promise<ProjectMemoryHit[]>;
  mirror(params: {
    text: string;
    kind?: MemoryKind | string;
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
