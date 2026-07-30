import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildRfc822, executeRun, summarise, type ProviderCall } from './execute.js';
import { storeTokens, secretRefFor, __clearMemoryVault } from './vault.js';
import type { DbLike } from './store.js';

/**
 * The execute path is the only place a token is read and the only place a write
 * leaves the platform. These tests pin the four guarantees in its header
 * comment: claim-once, re-validate from storage, connector must be live, token
 * read last.
 */

type Row = Record<string, unknown>;

function makeDb(script: Array<{ match: RegExp; rows: Row[] }>) {
  const seen: Array<{ sql: string; params: unknown[] }> = [];
  const db: DbLike = {
    async query<T>(sql: string, params: unknown[] = []) {
      seen.push({ sql, params });
      const hit = script.find((s) => s.match.test(sql));
      return { rows: (hit?.rows ?? []) as T[] };
    },
  };
  return { db, seen };
}

const OWNER = 'cognito-sub-1';
const RUN = '22222222-2222-4222-8222-222222222222';
const CONNECTOR = '33333333-3333-4333-8333-333333333333';
const SECRET = secretRefFor(OWNER, 'gmail');

function proposedRun(over: Row = {}): Row {
  return {
    id: RUN,
    owner_id: OWNER,
    connector_id: CONNECTOR,
    surface: 'chrome',
    action: 'gmail.send',
    proposed_action: {
      args: {
        to: ['alex@acme.test'],
        subject: 'Quote Q-4471',
        body: 'Attached.',
      },
    },
    confirmed: false,
    result: null,
    status: 'confirmed',
    error: null,
    created_at: new Date().toISOString(),
    executed_at: null,
    ...over,
  };
}

const liveConnector: Row = {
  id: CONNECTOR,
  owner_id: OWNER,
  provider: 'gmail',
  status: 'connected',
  scopes: ['https://www.googleapis.com/auth/gmail.compose'],
  secret_ref: SECRET,
  account_label: 'alex@acme.test',
  last_error: null,
  connected_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

beforeEach(async () => {
  __clearMemoryVault();
  delete process.env.CONNECTOR_SECRET_PREFIX;
  await storeTokens(SECRET, {
    accessToken: 'live-token',
    scopes: ['https://www.googleapis.com/auth/gmail.compose'],
  });
});

describe('claim-once', () => {
  it('refuses when the run is not pending, so a double confirm cannot resend', async () => {
    // claimRunForExecution returns nothing when status is already != 'proposed'.
    const { db } = makeDb([{ match: /UPDATE workflow_runs\s+SET status = 'confirmed'/, rows: [] }]);
    const out = await executeRun({ db, ownerId: OWNER, runId: RUN });
    expect(out).toMatchObject({ ok: false, status: 409 });
  });

  it('claims with an owner and status predicate in SQL', async () => {
    const { db, seen } = makeDb([
      { match: /SET status = 'confirmed'/, rows: [proposedRun()] },
      { match: /FROM connectors/, rows: [liveConnector] },
    ]);
    const call: ProviderCall = async () => ({ id: 'msg-1', threadId: 't-1' });
    await executeRun({ db, ownerId: OWNER, runId: RUN, providerCall: call });

    const claim = seen[0]!;
    expect(claim.sql).toMatch(/status = 'proposed'/);
    expect(claim.sql).toMatch(/owner_id = \$2/);
    expect(claim.params).toEqual([RUN, OWNER]);
  });
});

describe('re-validation from storage', () => {
  it('executes with the arguments that were stored, not any supplied later', async () => {
    const { db } = makeDb([
      { match: /SET status = 'confirmed'/, rows: [proposedRun()] },
      { match: /FROM connectors/, rows: [liveConnector] },
    ]);
    const seenArgs: Array<Record<string, unknown>> = [];
    const call: ProviderCall = async ({ args }) => {
      seenArgs.push(args);
      return { id: 'msg-1' };
    };
    const out = await executeRun({ db, ownerId: OWNER, runId: RUN, providerCall: call });
    expect(out.ok).toBe(true);
    expect(seenArgs[0]!.to).toEqual(['alex@acme.test']);
  });

  it('refuses a stored proposal that no longer validates', async () => {
    // e.g. the catalogue tightened, or the row was tampered with.
    const { db } = makeDb([
      {
        match: /SET status = 'confirmed'/,
        rows: [
          proposedRun({
            proposed_action: { args: { to: ['not-an-email'], subject: 's', body: 'b' } },
          }),
        ],
      },
    ]);
    const call = vi.fn();
    const out = await executeRun({
      db,
      ownerId: OWNER,
      runId: RUN,
      providerCall: call as unknown as ProviderCall,
    });
    expect(out).toMatchObject({ ok: false, status: 400 });
    expect(call).not.toHaveBeenCalled();
  });

  it('refuses a stored action that is not in the catalogue', async () => {
    const { db } = makeDb([
      { match: /SET status = 'confirmed'/, rows: [proposedRun({ action: 'gmail.delete_all' })] },
    ]);
    const call = vi.fn();
    const out = await executeRun({
      db,
      ownerId: OWNER,
      runId: RUN,
      providerCall: call as unknown as ProviderCall,
    });
    expect(out).toMatchObject({ ok: false, status: 400 });
    expect(call).not.toHaveBeenCalled();
  });

  it('accepts a proposal stored flat rather than under args', async () => {
    const { db } = makeDb([
      {
        match: /SET status = 'confirmed'/,
        rows: [
          proposedRun({
            proposed_action: { to: ['a@acme.test'], subject: 's', body: 'b' },
          }),
        ],
      },
      { match: /FROM connectors/, rows: [liveConnector] },
    ]);
    const out = await executeRun({
      db,
      ownerId: OWNER,
      runId: RUN,
      providerCall: async () => ({ id: 'm' }),
    });
    expect(out.ok).toBe(true);
  });
});

describe('connector state', () => {
  it('refuses when the provider is not connected', async () => {
    const { db } = makeDb([
      { match: /SET status = 'confirmed'/, rows: [proposedRun()] },
      { match: /FROM connectors/, rows: [] },
    ]);
    const call = vi.fn();
    const out = await executeRun({
      db,
      ownerId: OWNER,
      runId: RUN,
      providerCall: call as unknown as ProviderCall,
    });
    expect(out).toMatchObject({ ok: false, status: 409 });
    expect(call).not.toHaveBeenCalled();
  });

  it('refuses a revoked connection even though the row still exists', async () => {
    // The row is kept for audit; it must not still authorise anything.
    const { db } = makeDb([
      { match: /SET status = 'confirmed'/, rows: [proposedRun()] },
      { match: /FROM connectors/, rows: [{ ...liveConnector, status: 'revoked' }] },
    ]);
    const call = vi.fn();
    const out = await executeRun({
      db,
      ownerId: OWNER,
      runId: RUN,
      providerCall: call as unknown as ProviderCall,
    });
    expect(out).toMatchObject({ ok: false, status: 409 });
    expect(call).not.toHaveBeenCalled();
  });

  it('refuses when the vault has no token, and flags the connector', async () => {
    __clearMemoryVault();
    const { db, seen } = makeDb([
      { match: /SET status = 'confirmed'/, rows: [proposedRun()] },
      { match: /FROM connectors/, rows: [liveConnector] },
    ]);
    const out = await executeRun({ db, ownerId: OWNER, runId: RUN });
    expect(out).toMatchObject({ ok: false, status: 409 });
    expect(seen.some((q) => /SET status = 'error'/.test(q.sql))).toBe(true);
  });
});

describe('result handling', () => {
  it('records execution and returns the summarised result', async () => {
    const { db, seen } = makeDb([
      { match: /SET status = 'confirmed'/, rows: [proposedRun()] },
      { match: /FROM connectors/, rows: [liveConnector] },
    ]);
    const out = await executeRun({
      db,
      ownerId: OWNER,
      runId: RUN,
      providerCall: async () => ({ id: 'msg-9', threadId: 'thr-9', extra: 'dropped' }),
    });
    expect(out).toEqual({ ok: true, result: { messageId: 'msg-9', threadId: 'thr-9' } });
    expect(seen.some((q) => /SET status = 'executed'/.test(q.sql))).toBe(true);
  });

  it('records a provider failure against the run and the connector', async () => {
    const { db, seen } = makeDb([
      { match: /SET status = 'confirmed'/, rows: [proposedRun()] },
      { match: /FROM connectors/, rows: [liveConnector] },
    ]);
    const out = await executeRun({
      db,
      ownerId: OWNER,
      runId: RUN,
      providerCall: async () => {
        throw new Error('Invalid To header');
      },
    });
    expect(out).toMatchObject({ ok: false, status: 502, error: 'Invalid To header' });
    expect(seen.some((q) => /SET status = 'failed'/.test(q.sql))).toBe(true);
  });
});

describe('summarise', () => {
  it('keeps only what a surface renders from a calendar list', () => {
    const out = summarise('calendar.list_events', {
      items: [
        {
          id: 'e1',
          summary: 'Standup',
          start: { dateTime: '2026-08-03T09:00:00Z' },
          end: { dateTime: '2026-08-03T09:15:00Z' },
          attendees: [{ email: 'private@acme.test' }],
          conferenceData: { entryPoints: [{ uri: 'https://meet.test/x' }] },
        },
      ],
    });
    // Attendee emails and conference data are dropped: data minimisation, not
    // just payload size.
    expect(JSON.stringify(out)).not.toContain('private@acme.test');
    expect(JSON.stringify(out)).not.toContain('meet.test');
    expect(out).toEqual({
      events: [
        {
          id: 'e1',
          summary: 'Standup',
          start: '2026-08-03T09:00:00Z',
          end: '2026-08-03T09:15:00Z',
        },
      ],
    });
  });

  it('handles all-day events, which carry date instead of dateTime', () => {
    const out = summarise('calendar.list_events', {
      items: [{ id: 'e2', summary: 'Holiday', start: { date: '2026-08-03' }, end: { date: '2026-08-04' } }],
    });
    expect((out.events as Array<Record<string, unknown>>)[0]!.start).toBe('2026-08-03');
  });

  it('reduces a Stripe balance to amounts and currencies', () => {
    const out = summarise('stripe.balance', {
      available: [{ amount: 125_00, currency: 'gbp', source_types: { card: 1 } }],
      pending: [],
      livemode: true,
    });
    expect(out).toEqual({
      available: [{ amount: 12500, currency: 'gbp' }],
      pending: [],
    });
  });

  it('tolerates an empty or unexpected provider response', () => {
    expect(summarise('calendar.list_events', {})).toEqual({ events: [] });
    expect(summarise('stripe.recent_payments', {})).toEqual({ payments: [] });
  });
});

describe('buildRfc822', () => {
  it('builds a decodable message with the expected headers', () => {
    const raw = buildRfc822({
      to: ['alex@acme.test'],
      cc: ['sam@acme.test'],
      subject: 'Quote Q-4471',
      body: 'Line one\r\nLine two',
    });
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    expect(decoded).toContain('To: alex@acme.test');
    expect(decoded).toContain('Cc: sam@acme.test');
    expect(decoded).toContain('Subject: Quote Q-4471');
    expect(decoded).toContain('Line one\r\nLine two');
  });

  it('omits an empty Cc header rather than emitting a blank one', () => {
    const decoded = Buffer.from(
      buildRfc822({ to: ['a@acme.test'], subject: 's', body: 'b' }),
      'base64url',
    ).toString('utf8');
    expect(decoded).not.toContain('Cc:');
  });

  it('is base64url, which is what the Gmail API requires', () => {
    const raw = buildRfc822({ to: ['a@acme.test'], subject: 's', body: 'b' });
    expect(raw).not.toMatch(/[+/=]/);
  });
});
