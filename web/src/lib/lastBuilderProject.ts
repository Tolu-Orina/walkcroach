/** Persist / recall last App Builder project for the ecosystem rail. */

const KEY = 'walkcroach.lastBuilderProjectId';

export function rememberBuilderProject(projectId: string): void {
  try {
    localStorage.setItem(KEY, projectId);
  } catch {
    /* ignore */
  }
}

export function readLastBuilderProjectId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
