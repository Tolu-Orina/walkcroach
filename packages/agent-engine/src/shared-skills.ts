/**
 * Cross-surface shared skills via IDE BFF, backed by CockroachDB.
 * Account-scoped (not project-scoped) — a skill is a reusable recipe, not
 * tied to one project. Engine stays free of vscode / Cognito details — host
 * injects the bridge, mirroring ProjectMemoryBridge in project-memory.ts.
 */

export type SharedSkillRecord = {
  name: string;
  description: string;
  body: string;
  sourceSurface?: string;
};

export type SharedSkillSearchHit = SharedSkillRecord & {
  /** Cosine distance from CockroachDB `<=>` (lower is closer). */
  distance: number;
};

export type SharedSkillsBridge = {
  list(): Promise<SharedSkillRecord[]>;
  mirror(params: {
    name: string;
    description: string;
    body: string;
    /** Host surface label stored by BFF (default server-side: ide). */
    sourceSurface?: string;
  }): Promise<{ id: string }>;
  /**
   * Optional CRDB vector recall over the owner's shared_skills.
   * When present, the agent loop merges hits into the local skill-rank nudge.
   */
  search?(params: {
    query: string;
    limit?: number;
  }): Promise<SharedSkillSearchHit[]>;
};
