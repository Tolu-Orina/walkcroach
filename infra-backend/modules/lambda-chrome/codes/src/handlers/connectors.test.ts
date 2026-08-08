import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthContext } from '../auth.js';

/**
 * Chrome's connector routes (Phase E1).
 *
 * The point of these tests is that Chrome is a *consumer* of the shared platform:
 * validation, action definitions and execution all live in
 * `@walkcroach/connectors`, and these routes must not reimplement or bypass any
 * of it. Anonymous device sessions must also never reach a connector, because a
 * connection belongs to an account rather than a browser.
 */

type Row = Record<string, unknown>;
const queue: Array<{ match: RegExp; rows: Row[] }> = [];
const queries: Array<{ sql: string; params: unknown[] }> = [];
const executed: string[] = [];

vi.mock('@walkcroach/db', () => ({
  createDbClient: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const hit = queue.find((q) => q.match.test(sql));
      return { rows: hit?.rows ?? [] };
    },
    close: async () => {},
  }),
}));

const ledger = {
  entitlement: 'pro' as 'free' | 'starter' | 'pro',
  allow: true,
  debited: [] as Array<{ action: string }>,
};

vi.mock('@walkcroach/ledger', () => ({
  getEntitlement: async () => ledger.entitlement,
  hasConnectorWriteAccess: (plan: string) =>
    plan === 'starter' || plan === 'pro',
  assertCredits: async () =>
    ledger.allow ? { ok: true } : { ok: false, remaining: 0 },
  debitCredits: async (
    _db: unknown,
    _owner: string,
    action: string,
  ) => {
    ledger.debited.push({ action });
    return { ok: true, remaining: 97 };
  },
}));

vi.mock('@walkcroach/agent-harness', () => ({
  embedAndStoreWorkflowRun: async () => {},
}));

vi.mock('@walkcroach/connectors', async () => {
  const actual =
    await vi.importActual<typeof import('@walkcroach/connectors')>(
      '@walkcroach/connectors',
    );
  return {
    ...actual,
    // Only the network-touching parts are stubbed. Validation, the action
    // catalogue and the provider registry stay real, so a route that skipped
    // them would fail these tests.
    destroyTokens: async () => {},
    executeRun: async ({ runId }: { runId: string }) => {
      executed.push(runId);
      return { ok: true as const, result: { messageId: 'm-1' } };
    },
  };
});

const {
  handleDisconnectConnector,
  handleExecuteRun,
  handleListConnectors,
  handleProposeAction,
} = await import('./connectors.js');

const cognito: AuthContext = {
  ownerId: 'cognito-sub-1',
  isAnonymous: false,
  source: 'jwt',
};
const device: AuthContext = {
  ownerId: 'anon:device:abc',
  isAnonymous: true,
  source: 'device',
};

const RUN = '44444444-4444-4444-8444-444444444444';
const CONNECTOR_ID = '55555555-5555-4555-8555-555555555555';

const gmailConnector: Row = {
  id: CONNECTOR_ID,
  owner_id: cognito.ownerId,
  provider: 'gmail',
  status: 'connected',
  scopes: ['https://www.googleapis.com/auth/gmail.compose'],
  secret_ref: 'walkcroach/test/connectors/abc',
  account_label: 'alex@acme.test',
  last_error: null,
  connected_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function body(res: { body: string }): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>;
}

beforeEach(() => {
  queue.length = 0;
  queries.length = 0;
  executed.length = 0;
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'gid';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'gsecret';
  process.env.WEB_APP_URL = 'https://walkcroach.test';
  ledger.entitlement = 'pro';
  ledger.allow = true;
  ledger.debited.length = 0;
  delete process.env.SLACK_OAUTH_CLIENT_ID;
  delete process.env.STRIPE_OAUTH_CLIENT_ID;
});

describe('anonymous device sessions', () => {
  it('are told to sign in rather than shown connectors', async () => {
    const res = await handleListConnectors(device);
    expect(res.statusCode).toBe(200);
    expect(body(res).requiresSignIn).toBe(true);
    expect(body(res).providers).toEqual([]);
    // No database work for an anonymous caller.
    expect(queries).toHaveLength(0);
  });

  it('cannot propose, execute, or disconnect', async () => {
    for (const res of [
      await handleProposeAction(device, JSON.stringify({ action: 'gmail.send' })),
      await handleExecuteRun(device, RUN),
      await handleDisconnectConnector(device, 'gmail'),
    ]) {
      expect(res.statusCode).toBe(401);
    }
    expect(executed).toHaveLength(0);
    expect(queries).toHaveLength(0);
  });
});

describe('listing', () => {
  it('offers only providers with OAuth credentials configured', async () => {
    queue.push({ match: /FROM connectors/, rows: [] });
    const res = await handleListConnectors(cognito);
    const providers = body(res).providers as Array<Record<string, unknown>>;
    const ids = providers.map((p) => p.id);
    // Google is configured in beforeEach; Slack and Stripe are not.
    expect(ids).toContain('gmail');
    expect(ids).not.toContain('slack');
    expect(ids).not.toContain('stripe');
  });

  it('never returns the secret reference to a client', async () => {
    queue.push({ match: /FROM connectors/, rows: [gmailConnector] });
    const res = await handleListConnectors(cognito);
    expect(res.body).not.toContain('secret_ref');
    expect(res.body).not.toContain('walkcroach/test/connectors');
  });

  it('surfaces the connection and its account label', async () => {
    queue.push({ match: /FROM connectors/, rows: [gmailConnector] });
    const res = await handleListConnectors(cognito);
    const providers = body(res).providers as Array<Record<string, unknown>>;
    const gmail = providers.find((p) => p.id === 'gmail');
    expect(gmail?.connection).toMatchObject({
      status: 'connected',
      accountLabel: 'alex@acme.test',
    });
  });

  it('points at WalkCroach Web to connect, not at a Chrome-local flow', async () => {
    queue.push({ match: /FROM connectors/, rows: [] });
    const res = await handleListConnectors(cognito);
    expect(body(res).connectUrl).toBe(
      'https://walkcroach.test/app/settings/connections',
    );
  });
});

describe('propose', () => {
  it('rejects an action outside the shared catalogue', async () => {
    const res = await handleProposeAction(
      cognito,
      JSON.stringify({ action: 'gmail.delete_all', args: {} }),
    );
    expect(res.statusCode).toBe(400);
    expect(String(body(res).error)).toMatch(/unknown action/);
    expect(queries).toHaveLength(0);
  });

  it('applies the shared validation rather than its own', async () => {
    // Header injection in a subject — caught by the platform, not by this route.
    const res = await handleProposeAction(
      cognito,
      JSON.stringify({
        action: 'gmail.send',
        args: {
          to: ['a@acme.test'],
          subject: ['Quote', 'Bcc: attacker@evil.test'].join('\n'),
          body: 'x',
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(String(body(res).error)).toMatch(/single line/);
  });

  it('refuses when the provider is not connected, and says where to connect', async () => {
    queue.push({ match: /FROM connectors/, rows: [] });
    const res = await handleProposeAction(
      cognito,
      JSON.stringify({
        action: 'gmail.send',
        args: { to: ['a@acme.test'], subject: 's', body: 'b' },
      }),
    );
    expect(res.statusCode).toBe(409);
    expect(body(res).needsConnection).toBe('gmail');
    expect(String(body(res).connectUrl)).toContain('/app/settings/connections');
  });

  it('records the proposal and returns confirm-card rows', async () => {
    queue.push({ match: /FROM connectors/, rows: [gmailConnector] });
    queue.push({ match: /INSERT INTO workflow_runs/, rows: [{ id: RUN }] });
    const res = await handleProposeAction(
      cognito,
      JSON.stringify({
        action: 'gmail.send',
        args: { to: ['alex@acme.test'], subject: 'Quote', body: 'Attached.' },
      }),
    );
    expect(res.statusCode).toBe(201);
    expect(body(res)).toMatchObject({
      runId: RUN,
      action: 'gmail.send',
      write: true,
      weight: 2,
    });
    expect(String(body(res).consequence)).toMatch(/cannot be undone/i);
    expect(body(res).rows).toEqual([
      { label: 'To', value: 'alex@acme.test' },
      { label: 'Subject', value: 'Quote' },
      { label: 'Message', value: 'Attached.' },
    ]);
  });

  it('records the proposal as proposed, never as confirmed', async () => {
    queue.push({ match: /FROM connectors/, rows: [gmailConnector] });
    queue.push({ match: /INSERT INTO workflow_runs/, rows: [{ id: RUN }] });
    await handleProposeAction(
      cognito,
      JSON.stringify({
        action: 'gmail.draft',
        args: { to: ['a@acme.test'], subject: 's', body: 'b' },
      }),
    );
    const insert = queries.find((q) => /INSERT INTO workflow_runs/.test(q.sql));
    expect(insert!.sql).toContain("'proposed'");
    expect(insert!.params).toContain('chrome');
  });

  it('rejects a malformed body', async () => {
    const res = await handleProposeAction(cognito, '{ nope');
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toBe('invalid JSON body');
  });
});

describe('execute', () => {
  function pendingWrite() {
    queue.push({ match: /SELECT action FROM workflow_runs/, rows: [{ action: 'gmail.send' }] });
  }

  it('delegates to the shared execute path, passing only the run id', async () => {
    // No arguments cross this boundary: the payload is re-read server-side, so
    // confirming cannot substitute a different recipient.
    pendingWrite();
    const res = await handleExecuteRun(cognito, RUN);
    expect(res.statusCode).toBe(200);
    expect(executed).toEqual([RUN]);
    expect(body(res).result).toEqual({ messageId: 'm-1' });
  });

  it('409s when the run is no longer pending', async () => {
    queue.push({ match: /SELECT action FROM workflow_runs/, rows: [] });
    const res = await handleExecuteRun(cognito, RUN);
    expect(res.statusCode).toBe(409);
    expect(executed).toHaveLength(0);
  });

  it('debits the shared credit pool, which Chrome previously bypassed', async () => {
    // Before this, connector actions run from the side panel were free — the
    // "shared pool" was in practice a Web-only limit.
    pendingWrite();
    const res = await handleExecuteRun(cognito, RUN);
    expect(ledger.debited).toEqual([{ action: 'connector_write' }]);
    expect(body(res).creditsCharged).toBe(2);
    expect(body(res).remainingCredits).toBe(97);
  });

  it('refuses when the balance cannot cover the action, before executing', async () => {
    pendingWrite();
    ledger.allow = false;
    const res = await handleExecuteRun(cognito, RUN);
    expect(res.statusCode).toBe(402);
    expect(body(res).error).toBe('insufficient_credits');
    expect(executed).toHaveLength(0);
  });

  it('gates connector writes behind Starter/Pro, matching Web', async () => {
    pendingWrite();
    ledger.entitlement = 'free';
    const res = await handleExecuteRun(cognito, RUN);
    expect(res.statusCode).toBe(402);
    expect(body(res).error).toBe('upgrade_required');
    expect(executed).toHaveLength(0);
  });

  it('allows connector writes on Starter', async () => {
    pendingWrite();
    ledger.entitlement = 'starter';
    const res = await handleExecuteRun(cognito, RUN);
    expect(res.statusCode).toBe(200);
    expect(ledger.debited).toEqual([{ action: 'connector_write' }]);
  });

  it('allows a read action on a free plan', async () => {
    queue.push({
      match: /SELECT action FROM workflow_runs/,
      rows: [{ action: 'calendar.list_events' }],
    });
    ledger.entitlement = 'free';
    const res = await handleExecuteRun(cognito, RUN);
    expect(res.statusCode).toBe(200);
    expect(ledger.debited).toEqual([{ action: 'connector_read' }]);
    expect(body(res).creditsCharged).toBe(1);
  });
});

describe('disconnect', () => {
  it('rejects an unknown provider', async () => {
    const res = await handleDisconnectConnector(cognito, 'not_a_provider');
    expect(res.statusCode).toBe(400);
  });

  it('404s when there is nothing connected', async () => {
    queue.push({ match: /FROM connectors/, rows: [] });
    const res = await handleDisconnectConnector(cognito, 'gmail');
    expect(res.statusCode).toBe(404);
  });

  it('revokes the row so history stays auditable', async () => {
    queue.push({ match: /FROM connectors/, rows: [gmailConnector] });
    queue.push({ match: /SET status = 'revoked'/, rows: [gmailConnector] });
    const res = await handleDisconnectConnector(cognito, 'gmail');
    expect(res.statusCode).toBe(200);
    // Revoked, not deleted: workflow_runs still reference this connector.
    const update = queries.find((q) => /SET status = 'revoked'/.test(q.sql));
    expect(update).toBeDefined();
    expect(queries.some((q) => /DELETE FROM connectors/.test(q.sql))).toBe(false);
  });
});
