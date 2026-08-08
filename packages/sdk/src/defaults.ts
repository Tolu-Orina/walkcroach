/**
 * Public production API hostname (Phase P5.1).
 *
 * Zone: rinegansolutions.com (owned). Portal stays on
 * walkcroach.rinegansolutions.com. Execute-api URLs remain valid until
 * DNS/ACM cutover completes; clients default here so we never ship unowned
 * *.walkcroach.dev placeholders.
 */
export const PRODUCTION_API_HOST = 'api.walkcroach.rinegansolutions.com';

/** SDK / OpenAPI base (paths already include `/v1/...`). */
export const PRODUCTION_API_ORIGIN = `https://${PRODUCTION_API_HOST}`;

/**
 * CLI / IDE / Chrome invoke-style base (stage name is `v1` on the gateway).
 * Same host; `/v1` prefix matches execute-api and custom-domain base-path mapping.
 */
export const PRODUCTION_API_BASE_URL = `${PRODUCTION_API_ORIGIN}/v1`;

/** Must match package.json version — used in User-Agent. */
export const SDK_PACKAGE_VERSION = '0.2.0';
