/**
 * Cross-surface project memory via IDE BFF (Phase C).
 * Engine stays free of vscode / Cognito details — host injects the bridge.
 */

export type ProjectMemoryHit = {
  id: string;
  kind: string;
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
    kind?: string;
  }): Promise<{ id: string }>;
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
