import { describe, expect, it } from 'vitest';
import {
  PROVIDERS,
  configuredProviders,
  listableProviders,
  providerUnavailableReason,
} from './providers.js';

/**
 * Two different reasons a provider may not be connectable, and they must not be
 * conflated:
 *
 *   no credentials  temporary, environmental — hide it entirely
 *   comingSoon      a decision we have made — announce it, disabled
 */
describe('coming-soon providers', () => {
  const creds = {
    GOOGLE_OAUTH_CLIENT_ID: 'g',
    GOOGLE_OAUTH_CLIENT_SECRET: 'g',
    SLACK_OAUTH_CLIENT_ID: 's',
    SLACK_OAUTH_CLIENT_SECRET: 's',
    HUBSPOT_OAUTH_CLIENT_ID: 'h',
    HUBSPOT_OAUTH_CLIENT_SECRET: 'h',
  };

  it('never offers a coming-soon provider, even with credentials present', () => {
    // The load-bearing assertion: shipping is a decision, not a side effect of
    // someone adding a secret. HubSpot's credentials being set must not start
    // an OAuth flow we have said is not ready.
    const ids = configuredProviders(creds).map((p) => p.id);
    expect(ids).not.toContain('hubspot');
    expect(ids).toContain('slack');
  });

  it('lists it as visible but not connectable', () => {
    const hubspot = listableProviders(creds).find((p) => p.id === 'hubspot');
    expect(hubspot).toBeDefined();
    expect(hubspot?.connectable).toBe(false);
    expect(hubspot?.comingSoon).toMatch(/Projects/);
  });

  it('marks genuinely available providers connectable', () => {
    const slack = listableProviders(creds).find((p) => p.id === 'slack');
    expect(slack?.connectable).toBe(true);
    expect(slack?.comingSoon).toBeUndefined();
  });

  it('lists google_drive when Google credentials are present', () => {
    const drive = listableProviders(creds).find((p) => p.id === 'google_drive');
    expect(drive).toBeDefined();
    expect(drive?.connectable).toBe(true);
    expect(drive?.scopes).toEqual([
      'https://www.googleapis.com/auth/drive.file',
    ]);
  });

  it('omits an unconfigured provider entirely rather than showing it', () => {
    // Absent credentials is a different state from coming-soon: temporary and
    // environmental, so the provider is hidden rather than announced.
    const ids = listableProviders({}).map((p) => p.id);
    expect(ids).not.toContain('slack');
    expect(ids).toContain('hubspot');
  });
});

describe('providerUnavailableReason', () => {
  const hubspot = PROVIDERS.hubspot;
  const gmail = PROVIDERS.gmail;

  it('refuses a coming-soon provider even when its credentials are present', () => {
    // The regression this exists for: dropping HubSpot keys into the runtime
    // secret used to be enough to make the flow startable. Shipping a provider
    // must be a decision, never a side effect of a secret appearing.
    const env = {
      [hubspot.clientIdEnv]: 'id',
      [hubspot.clientSecretEnv]: 'secret',
    } as NodeJS.ProcessEnv;

    expect(providerUnavailableReason(hubspot, env)).toEqual({
      code: 'coming_soon',
      message: hubspot.comingSoon,
    });
  });

  it('reports a shipped provider with no credentials as unconfigured', () => {
    expect(providerUnavailableReason(gmail, {} as NodeJS.ProcessEnv)).toMatchObject({
      code: 'provider_not_configured',
    });
  });

  it('returns null only when the provider is both shipped and configured', () => {
    const env = {
      [gmail.clientIdEnv]: 'id',
      [gmail.clientSecretEnv]: 'secret',
    } as NodeJS.ProcessEnv;

    expect(providerUnavailableReason(gmail, env)).toBeNull();
  });

  it('treats whitespace-only credentials as absent', () => {
    const env = {
      [gmail.clientIdEnv]: '   ',
      [gmail.clientSecretEnv]: 'secret',
    } as NodeJS.ProcessEnv;

    expect(providerUnavailableReason(gmail, env)?.code).toBe('provider_not_configured');
  });

  it('agrees with configuredProviders on every provider', () => {
    // Two code paths deciding availability separately is how the gap appeared.
    // If they ever disagree again, this fails.
    const env = Object.fromEntries(
      Object.values(PROVIDERS).flatMap((p) => [
        [p.clientIdEnv, 'id'],
        [p.clientSecretEnv, 'secret'],
      ]),
    ) as NodeJS.ProcessEnv;

    const viaConfigured = new Set(configuredProviders(env).map((p) => p.id));
    for (const p of Object.values(PROVIDERS)) {
      expect(providerUnavailableReason(p, env) === null).toBe(viaConfigured.has(p.id));
    }
  });
});
