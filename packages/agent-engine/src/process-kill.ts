import { spawn } from 'node:child_process';

/**
 * Kill a process and its descendants. Needed because `shell: true` (and
 * npx/vite) spawn children that survive a plain `child.kill()`.
 */
export function killProcessTree(pid: number | undefined | null): void {
  if (pid == null || !Number.isFinite(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        detached: true,
      }).unref();
      return;
    }
    // Prefer process-group kill when the child was started detached.
    try {
      process.kill(-pid, 'SIGKILL');
      return;
    } catch {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    // Already dead or inaccessible.
  }
}
