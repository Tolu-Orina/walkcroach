import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { metricLog, parseJsonBody } from '../util.js';

const ALLOWED = new Set([
  'chrome.permission.grant',
  'chrome.permission.revoke',
]);

/**
 * Lightweight trust-proxy telemetry (PD.7).
 * Accepts only allowlisted event names; never stores page content.
 */
export async function handleTelemetry(
  _auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const body = parseJsonBody<{
    event?: string;
    origin?: string;
  }>(rawBody);
  if ('error' in body && body.error === 'invalid JSON body') {
    return jsonResponse(400, { error: body.error });
  }
  const b = body as { event?: string; origin?: string };
  if (!b.event || !ALLOWED.has(b.event)) {
    return jsonResponse(400, { error: 'event not allowed' });
  }

  let host: string | undefined;
  if (b.origin) {
    try {
      host = new URL(b.origin.replace(/\/\*$/, '/')).host;
    } catch {
      host = 'invalid';
    }
  }

  metricLog(b.event, { host });
  return jsonResponse(200, { ok: true });
}
