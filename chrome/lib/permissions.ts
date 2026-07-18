import { loadSession } from './auth';
import { API_BASE } from './api';

export async function originFromUrl(url: string): Promise<string> {
  const u = new URL(url);
  return `${u.protocol}//${u.host}/*`;
}

export async function hasOriginPermission(originPattern: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [originPattern] });
}

async function reportPermissionEvent(
  event: 'chrome.permission.grant' | 'chrome.permission.revoke',
  origin: string,
): Promise<void> {
  try {
    const session = await loadSession();
    if (!session?.accessToken) return;
    const base = API_BASE.replace(/\/$/, '');
    await fetch(`${base}/chrome/v1/telemetry`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ event, origin }),
    });
  } catch {
    // Telemetry must never block UX
  }
}

/** Request host permission on user gesture (summarize / save). */
export async function ensureOriginPermission(pageUrl: string): Promise<boolean> {
  const origin = await originFromUrl(pageUrl);
  if (await hasOriginPermission(origin)) return true;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (granted) void reportPermissionEvent('chrome.permission.grant', origin);
  return granted;
}

export async function listGrantedOrigins(): Promise<string[]> {
  const all = await chrome.permissions.getAll();
  return all.origins ?? [];
}

export async function revokeOrigin(origin: string): Promise<boolean> {
  const removed = await chrome.permissions.remove({ origins: [origin] });
  if (removed) void reportPermissionEvent('chrome.permission.revoke', origin);
  return removed;
}
