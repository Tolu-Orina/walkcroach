/**
 * Resolve a fresh access token for a connected provider.
 * Shared by Drive picker-session and Drive import.
 */
import type { DbLike } from './store.js';
import { getConnector, markConnectorError } from './store.js';
import { getProvider, type ProviderId } from './providers.js';
import { isExpired, refreshAccessToken, type TokenSet } from './oauth.js';
import { loadTokens, storeTokens } from './vault.js';

export async function resolveConnectorAccessToken(
  db: DbLike,
  ownerId: string,
  providerId: ProviderId,
): Promise<
  | { ok: true; tokens: TokenSet; clientId: string }
  | { ok: false; error: string; code: 'not_connected' | 'token' | 'provider' }
> {
  const def = getProvider(providerId);
  if (!def) {
    return { ok: false, error: 'Unknown provider', code: 'provider' };
  }
  const clientId = process.env[def.clientIdEnv]?.trim();
  if (!clientId) {
    return {
      ok: false,
      error: `${def.label} is not configured on this deployment.`,
      code: 'provider',
    };
  }

  const connector = await getConnector(db, ownerId, providerId);
  if (!connector || connector.status === 'revoked') {
    return {
      ok: false,
      error: `${def.label} is not connected.`,
      code: 'not_connected',
    };
  }

  let tokens = await loadTokens(connector.secret_ref);
  if (!tokens) {
    await markConnectorError(db, ownerId, providerId, 'tokens_missing');
    return {
      ok: false,
      error: 'Stored credentials are missing. Reconnect Google Drive.',
      code: 'token',
    };
  }

  if (isExpired(tokens)) {
    if (!tokens.refreshToken) {
      return {
        ok: false,
        error: 'Session expired. Reconnect Google Drive.',
        code: 'token',
      };
    }
    const refreshed = await refreshAccessToken({
      providerId,
      refreshToken: tokens.refreshToken,
    });
    if ('error' in refreshed) {
      await markConnectorError(db, ownerId, providerId, refreshed.error);
      return {
        ok: false,
        error: 'Could not refresh Google Drive access. Reconnect and try again.',
        code: 'token',
      };
    }
    tokens = refreshed;
    await storeTokens(connector.secret_ref, tokens);
  }

  return { ok: true, tokens, clientId };
}
