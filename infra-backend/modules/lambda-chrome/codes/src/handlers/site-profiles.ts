import { jsonResponse } from '../http.js';
import { metricLog } from '../util.js';

/**
 * Signed site-profile bundle (Phase D6).
 *
 * Profiles are copy and match patterns, so a wording fix should not need a
 * Chrome Web Store review. The extension fetches this and applies it only if the
 * Ed25519 signature verifies against a public key baked into its build.
 *
 * The response is served verbatim from configuration, not composed here: the
 * signature covers exact bytes, so re-serialising the JSON on this side would
 * invalidate it. `bundle` is therefore a *string*, signed as-is.
 *
 * Unconfigured is a valid state. Returning 404 tells the extension to keep using
 * its packaged profiles, which is the correct behaviour before signing keys are
 * provisioned — and means this route can ship ahead of the key material.
 */
export function handleSiteProfiles(): ReturnType<typeof jsonResponse> {
  const bundle = process.env.CHROME_SITE_PROFILES_BUNDLE?.trim();
  const signature = process.env.CHROME_SITE_PROFILES_SIGNATURE?.trim();

  if (!bundle || !signature) {
    metricLog('chrome.profiles.unconfigured', { ok: false });
    return jsonResponse(404, { error: 'site profiles not configured' });
  }

  metricLog('chrome.profiles.served', { ok: true, bytes: bundle.length });
  return {
    ...jsonResponse(200, { bundle, signature }),
    headers: {
      ...jsonResponse(200, {}).headers,
      // Profiles change rarely and the client caches for 12h; this keeps a
      // reload from hitting the Lambda on every panel open.
      'cache-control': 'public, max-age=3600',
    },
  };
}
