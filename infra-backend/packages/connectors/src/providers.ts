/**
 * Provider registry — the single source of truth for every surface.
 *
 * Web Chat, the Chrome side panel, the IDE and the CLI all read this list. A
 * provider added here becomes available everywhere at once, and — more
 * importantly — the scopes granted are defined once, so no surface can quietly
 * request broader access than another.
 *
 * Scope minimisation is a stated security requirement (web plan §6.4). Each
 * scope below is the narrowest that supports the actions in `actions.ts`; adding
 * an action that needs more is a deliberate, reviewable change here.
 */

export type ProviderId =
  | 'google_calendar'
  | 'gmail'
  | 'google_sheets'
  | 'slack'
  | 'stripe'
  | 'hubspot';

export type ProviderTier = 1 | 2 | 3;

export type ProviderDef = {
  id: ProviderId;
  label: string;
  /** Roadmap tier (master §3.2). Surfaces may hide untiered providers. */
  tier: ProviderTier;
  /** OAuth authorize endpoint. */
  authorizeUrl: string;
  /** OAuth token endpoint. */
  tokenUrl: string;
  /** Exact scopes requested. Never widen without review. */
  scopes: string[];
  /** Providers that require PKCE, or for which it is harmless and preferred. */
  usePkce: boolean;
  /** Extra authorize params (Google needs these for a refresh token). */
  extraAuthParams?: Record<string, string>;
  /** Env var names holding the OAuth app credentials. */
  clientIdEnv: string;
  clientSecretEnv: string;
  /** One line shown to the user before they connect. */
  disclosure: string;
  /**
   * Announced but not yet connectable, with the reason.
   *
   * Distinct from "no credentials configured", which hides a provider entirely.
   * That default is right when the absence is temporary or environmental — a
   * secret not yet added. It is the wrong shape for something we have decided
   * not to ship yet, where silence reads as "unsupported" and a user asks for a
   * feature that already exists in the code.
   *
   * A provider marked here is listed, visibly disabled, and cannot start an
   * OAuth flow — `configuredProviders` still excludes it, so nothing downstream
   * can accidentally attempt a connection.
   */
  comingSoon?: string;
};

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

/**
 * Google issues a refresh token only with `access_type=offline`, and only on the
 * *first* consent unless `prompt=consent` forces it. Without both, a reconnect
 * silently yields an access-token-only grant that dies in an hour.
 */
const GOOGLE_AUTH_PARAMS = {
  access_type: 'offline',
  prompt: 'consent',
  include_granted_scopes: 'true',
};

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  google_calendar: {
    id: 'google_calendar',
    label: 'Google Calendar',
    tier: 1,
    authorizeUrl: GOOGLE_AUTH,
    tokenUrl: GOOGLE_TOKEN,
    // `calendar.events` only — not `calendar`, which also grants calendar
    // creation and deletion that no action here needs.
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
    usePkce: true,
    extraAuthParams: GOOGLE_AUTH_PARAMS,
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    disclosure:
      'Read and create events on your Google Calendar. WalkCroach never deletes events.',
  },
  gmail: {
    id: 'gmail',
    label: 'Gmail',
    tier: 1,
    authorizeUrl: GOOGLE_AUTH,
    tokenUrl: GOOGLE_TOKEN,
    // `gmail.compose` covers drafting and sending. Deliberately not
    // `gmail.readonly` or `mail.google.com`: WalkCroach has no action that reads
    // a mailbox, so it does not ask for the ability to.
    scopes: ['https://www.googleapis.com/auth/gmail.compose'],
    usePkce: true,
    extraAuthParams: GOOGLE_AUTH_PARAMS,
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    disclosure:
      'Create drafts and send email as you. WalkCroach cannot read your inbox.',
  },
  google_sheets: {
    id: 'google_sheets',
    label: 'Google Sheets',
    tier: 1,
    authorizeUrl: GOOGLE_AUTH,
    tokenUrl: GOOGLE_TOKEN,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    usePkce: true,
    extraAuthParams: GOOGLE_AUTH_PARAMS,
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    disclosure: 'Read and append rows in spreadsheets you choose.',
  },
  slack: {
    id: 'slack',
    label: 'Slack',
    tier: 1,
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write', 'channels:read'],
    usePkce: false,
    clientIdEnv: 'SLACK_OAUTH_CLIENT_ID',
    clientSecretEnv: 'SLACK_OAUTH_CLIENT_SECRET',
    disclosure: 'Post messages to channels you pick. No message history is read.',
  },
  stripe: {
    id: 'stripe',
    label: 'Stripe',
    tier: 2,
    authorizeUrl: 'https://connect.stripe.com/oauth/authorize',
    tokenUrl: 'https://connect.stripe.com/oauth/token',
    // Read-only. Every Stripe action in this build is a query; a write scope
    // would be an unearned liability on money movement.
    scopes: ['read_only'],
    usePkce: false,
    clientIdEnv: 'STRIPE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'STRIPE_OAUTH_CLIENT_SECRET',
    disclosure:
      'Read your balance and recent payments. WalkCroach cannot move money or issue refunds.',
  },
  hubspot: {
    id: 'hubspot',
    label: 'HubSpot',
    tier: 2,
    authorizeUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'],
    usePkce: false,
    clientIdEnv: 'HUBSPOT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'HUBSPOT_OAUTH_CLIENT_SECRET',
    /**
     * HubSpot sunset legacy public-app creation in mid-2026. OAuth credentials
     * now require the Projects framework — install the `hs` CLI, scaffold a
     * project, deploy it, then read the client id and secret back out. Every
     * other provider here is a two-field form.
     *
     * The integration itself is complete and unchanged; only the credential
     * path is. Remove this line once the project is deployed and the secrets
     * are in `walkcroach/{env}/runtime`.
     */
    comingSoon: 'HubSpot requires their new Projects app framework — coming soon.',
    disclosure: 'Read and create contacts in your CRM.',
  },
};

export function getProvider(id: string): ProviderDef | null {
  return (PROVIDERS as Record<string, ProviderDef>)[id] ?? null;
}

export function isProviderId(id: string): id is ProviderId {
  return id in PROVIDERS;
}

/**
 * Providers with OAuth app credentials actually configured.
 *
 * A provider without credentials is not offered rather than shown and then
 * failing at the consent screen — the same fail-closed posture as signed site
 * profiles.
 */
export function configuredProviders(
  env: NodeJS.ProcessEnv = process.env,
): ProviderDef[] {
  return Object.values(PROVIDERS).filter(
    (p) =>
      !p.comingSoon &&
      Boolean(env[p.clientIdEnv]?.trim()) &&
      Boolean(env[p.clientSecretEnv]?.trim()),
  );
}

/**
 * Why a provider cannot be connected right now, or null if it can.
 *
 * The single check every entry point must use. Listing a provider correctly is
 * not enough: `handleConnectorOauthStart` is reachable directly, so a UI that
 * merely disables a button leaves the flow startable by anyone who calls the
 * API. Credentials existing must never be sufficient on its own.
 */
export function providerUnavailableReason(
  def: ProviderDef,
  env: NodeJS.ProcessEnv = process.env,
): { code: 'coming_soon' | 'provider_not_configured'; message: string } | null {
  if (def.comingSoon) {
    return { code: 'coming_soon', message: def.comingSoon };
  }
  const id = env[def.clientIdEnv]?.trim();
  const secret = env[def.clientSecretEnv]?.trim();
  if (!id || !secret) {
    return {
      code: 'provider_not_configured',
      message: `${def.label} is not configured on this deployment.`,
    };
  }
  return null;
}

/**
 * Providers to LIST, including any that cannot yet be connected.
 *
 * Returns `connectable: false` for coming-soon entries so a surface can render
 * them disabled without needing to know why. Credentials are never consulted
 * for those — a coming-soon provider stays unconnectable even if someone adds
 * its secrets, which is the point: shipping is a decision, not a side effect of
 * a secret appearing.
 */
export function listableProviders(
  env: NodeJS.ProcessEnv = process.env,
): Array<ProviderDef & { connectable: boolean }> {
  const connectable = new Set(configuredProviders(env).map((p) => p.id));
  return Object.values(PROVIDERS)
    .filter((p) => connectable.has(p.id) || Boolean(p.comingSoon))
    .map((p) => ({ ...p, connectable: connectable.has(p.id) }));
}
