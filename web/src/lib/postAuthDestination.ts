/**
 * Post-auth destination + resume-gate skip window.
 * Deep links (?next=) always win; welcome tour still runs once.
 */

import { hasCompletedWelcome } from '../auth/session';

const SKIP_UNTIL_KEY = 'walkcroach.resume.skipUntil';

/** Safe in-app path from ?next=, or null. */
export function safeNextPath(nextParam: string | null | undefined): string | null {
  if (!nextParam || !nextParam.startsWith('/') || nextParam.startsWith('//')) {
    return null;
  }
  return nextParam;
}

/**
 * Where to send the user after successful sign-in / verify.
 * Welcome (first run) → /welcome; otherwise → /app/resume (chooser or passthrough).
 */
export function postAuthDestination(nextParam?: string | null): string {
  const next = safeNextPath(nextParam ?? null);
  if (next) return next;
  if (!hasCompletedWelcome()) return '/welcome';
  return '/app/resume';
}

/** Skip the resume chooser until this timestamp (ms). */
export function readResumeSkipUntil(): number {
  try {
    const raw = localStorage.getItem(SKIP_UNTIL_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function isResumeSkipped(): boolean {
  return Date.now() < readResumeSkipUntil();
}

/** Remember choice for ~24h so returning power users aren't interrupted. */
export function markResumeChoiceMade(): void {
  try {
    localStorage.setItem(
      SKIP_UNTIL_KEY,
      String(Date.now() + 24 * 60 * 60 * 1000),
    );
  } catch {
    /* ignore */
  }
}
