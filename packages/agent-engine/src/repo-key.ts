import { createHash } from 'node:crypto';

/**
 * Stable local repo identity — must match IDE BFF normalizeLocalRepoKey.
 * Strips credentials from remotes before hashing/storing (security).
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

/** Public helper for display strings (no credentials). */
export function canonicalizeGitRemote(remote: string): string {
  let u = remote.trim();
  u = u.replace(/\.git$/i, '');
  u = u.replace(/^git@([^:]+):/, 'https://$1/');
  u = u.replace(/^ssh:\/\/git@/i, 'https://');
  u = u.replace(/^git:\/\//i, 'https://');
  // Strip userinfo (tokens/passwords) from https remotes
  try {
    const parsed = new URL(u);
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    // Drop default ports
    let out = parsed.toString().replace(/\/$/, '');
    out = out.toLowerCase();
    return out;
  } catch {
    // Fallback: strip user:pass@ manually
    let fallback = u.replace(/^(https?:\/\/)[^/@]+@/i, '$1');
    fallback = fallback.replace(/\/+$/, '').toLowerCase();
    return fallback;
  }
}
