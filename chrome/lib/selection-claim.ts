/**
 * Resolve which workspace receives a pending selection save.
 *
 * When the panel has no active workspace (empty list / race), create or reuse
 * one via `ensureNamed` — never pass an empty workspaceId to the BFF.
 */
export async function workspaceIdForPendingSave(opts: {
  activeWs: string | null | undefined;
  ensureNamed: (name: string) => Promise<string>;
  fallbackName: string;
}): Promise<string> {
  const active = opts.activeWs?.trim();
  if (active) return active;
  const created = (await opts.ensureNamed(opts.fallbackName)).trim();
  if (!created) {
    throw new Error('Could not create a workspace for this selection.');
  }
  return created;
}
