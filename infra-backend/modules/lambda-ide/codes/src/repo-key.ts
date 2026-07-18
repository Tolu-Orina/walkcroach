import { createHash } from 'node:crypto';

/**
 * Stable local repo identity for ide_project_links.local_repo_key (FR-D26).
 * Prefer normalized git remote; else hash of workspace path.
 * Strips credentials from remotes before storage.
 */
export function normalizeLocalRepoKey(input: {
  gitRemoteUrl?: string | null;
  workspacePath?: string | null;
}): string {
  const remote = input.gitRemoteUrl?.trim();
  if (remote) {
    return `git:${canonicalizeGitRemote(remote)}`;
  }
  const path = (input.workspacePath ?? '')
    .trim()
    .replace(/\\/g, '/')
    .toLowerCase();
  if (!path) {
    throw new Error('local_repo_key requires gitRemoteUrl or workspacePath');
  }
  const hash = createHash('sha256').update(path).digest('hex').slice(0, 32);
  return `path:${hash}`;
}

export function canonicalizeGitRemote(remote: string): string {
  let u = remote.trim();
  u = u.replace(/\.git$/i, '');
  u = u.replace(/^git@([^:]+):/, 'https://$1/');
  u = u.replace(/^ssh:\/\/git@/i, 'https://');
  u = u.replace(/^git:\/\//i, 'https://');
  try {
    const parsed = new URL(u);
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return u.replace(/^(https?:\/\/)[^/@]+@/i, '$1').replace(/\/+$/, '').toLowerCase();
  }
}
