/**
 * Git worktree helpers for enter_worktree / exit_worktree (D5.2 / fleet-primitives §3.1).
 */
import { mkdir, access } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
import { spawn } from 'node:child_process';

export type WorktreeEnterResult = {
  path: string;
  branch: string;
  repoRoot: string;
};

export type WorktreeExitResult = {
  path: string;
  action: 'apply' | 'discard';
  merged?: boolean;
};

function runGit(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, {
      cwd,
      shell: false,
      signal,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString('utf8');
    });
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

function sanitizeBranch(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9._/-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!cleaned) {
    throw new Error('enter_worktree: branch_name is empty after sanitization');
  }
  return cleaned;
}

function worktreeDirFor(repoRoot: string, branch: string): string {
  const leaf = basename(branch.replace(/\//g, '-')) || 'agent';
  return join(repoRoot, '.walkcroach', 'worktrees', leaf);
}

/**
 * `git worktree add` under `.walkcroach/worktrees/<branch>`.
 * Creates a new branch from `baseRef` (default HEAD) when the branch does not exist.
 */
export async function enterGitWorktree(
  repoRoot: string,
  branchName: string,
  baseRef?: string,
  signal?: AbortSignal,
): Promise<WorktreeEnterResult> {
  const branch = sanitizeBranch(branchName);
  const base = (baseRef?.trim() || 'HEAD').replace(/[^\w./~^-]+/g, '');
  const abs = worktreeDirFor(repoRoot, branch);
  await mkdir(join(repoRoot, '.walkcroach', 'worktrees'), { recursive: true });

  try {
    await access(abs);
    // Already present — reuse.
    return { path: abs, branch, repoRoot: resolve(repoRoot) };
  } catch {
    /* create */
  }

  // Prefer new branch from base; if branch exists, add without -b.
  let result = await runGit(
    repoRoot,
    ['worktree', 'add', '-b', branch, abs, base || 'HEAD'],
    signal,
  );
  if (result.code !== 0) {
    result = await runGit(repoRoot, ['worktree', 'add', abs, branch], signal);
  }
  if (result.code !== 0) {
    throw new Error(
      `git worktree add failed: ${(result.stderr || result.stdout).trim() || `exit ${result.code}`}`,
    );
  }
  return { path: abs, branch, repoRoot: resolve(repoRoot) };
}

/**
 * Leave a worktree: `apply` merges branch into the repo's current branch then removes;
 * `discard` removes without merging.
 */
export async function exitGitWorktree(
  repoRoot: string,
  worktreePath: string,
  branch: string,
  action: 'apply' | 'discard',
  signal?: AbortSignal,
): Promise<WorktreeExitResult> {
  const abs = resolve(worktreePath);
  let merged = false;

  if (action === 'apply') {
    const merge = await runGit(repoRoot, ['merge', '--no-ff', branch, '-m', `Merge worktree ${branch}`], signal);
    if (merge.code !== 0) {
      throw new Error(
        `git merge ${branch} failed (resolve conflicts in the main worktree, then retry exit_worktree): ${(merge.stderr || merge.stdout).trim()}`,
      );
    }
    merged = true;
  }

  const remove = await runGit(repoRoot, ['worktree', 'remove', '--force', abs], signal);
  if (remove.code !== 0) {
    throw new Error(
      `git worktree remove failed: ${(remove.stderr || remove.stdout).trim() || `exit ${remove.code}`}`,
    );
  }

  if (action === 'discard') {
    await runGit(repoRoot, ['branch', '-D', branch], signal);
  }

  return { path: abs, action, merged };
}
