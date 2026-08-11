/** Canonical App Builder workspace URL (ADR-0004 Phase 6). */
export function builderWorkspacePath(projectId: string): string {
  return `/app/builder/${projectId}`;
}

/** Hub — list / create App Builder workspaces. */
export const BUILDER_HUB_PATH = '/app/builder';
