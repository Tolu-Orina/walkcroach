/** Persist last knowledge project for post-login resume chooser. */

const KEY = 'walkcroach.lastKnowledgeProjectId';

export function rememberKnowledgeProject(projectId: string): void {
  try {
    localStorage.setItem(KEY, projectId);
  } catch {
    /* ignore */
  }
}

export function readLastKnowledgeProjectId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
