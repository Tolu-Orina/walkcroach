import type { HostAdapter } from './host.js';

export const WALKCROACH_MD = 'WALKCROACH.md';

export async function readWalkcroachMd(
  host: HostAdapter,
): Promise<string | undefined> {
  try {
    return await host.readFile(WALKCROACH_MD);
  } catch {
    return undefined;
  }
}

export function mergeWalkcroachAppend(
  existing: string | undefined,
  appendSection: string,
): string {
  const base = (existing ?? '# WALKCROACH.md\n\nProject conventions and decisions.\n').trimEnd();
  const section = appendSection.trim();
  if (!section) return `${base}\n`;
  return `${base}\n\n${section}\n`;
}
