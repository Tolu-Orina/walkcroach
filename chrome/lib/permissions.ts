/**
 * activeTab-only model (v0.1.3): no chrome.permissions host grants.
 * Kept as thin helpers so call sites stay stable.
 */

export async function originFromUrl(url: string): Promise<string> {
  const u = new URL(url);
  return `${u.protocol}//${u.host}/*`;
}

/** Always true — page access uses activeTab + scripting on user gesture. */
export async function ensureOriginPermission(_pageUrl: string): Promise<boolean> {
  return true;
}

export async function hasOriginPermission(_originPattern: string): Promise<boolean> {
  return false;
}

export async function listGrantedOrigins(): Promise<string[]> {
  return [];
}

export async function revokeOrigin(_origin: string): Promise<boolean> {
  return false;
}
