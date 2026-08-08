/** Short-lived signup credentials so verify can auto sign-in (session only). */

const KEY = 'walkcroach.signup.pending.v1';

export type PendingSignup = {
  email: string;
  password: string;
};

export function stashPendingSignup(pending: PendingSignup): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    /* private mode / quota */
  }
}

export function readPendingSignup(): PendingSignup | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSignup;
    if (!parsed?.email || !parsed?.password) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingSignup(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
