import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@walkcroach/agent-harness', () => ({
  eraseMemoryEntries: vi.fn(async () => ({ erased: 0, entryIds: [], exportBundle: null })),
}));

vi.mock('@walkcroach/connectors', () => ({
  listConnectors: vi.fn(async () => []),
  revokeConnector: vi.fn(async () => null),
  destroyTokens: vi.fn(async () => {}),
}));

vi.mock('../artefacts.js', () => ({
  deleteObjects: vi.fn(async () => 0),
  deletePrefix: vi.fn(async () => 0),
}));

vi.mock('./billing.js', () => ({
  applySubscriptionPlan: vi.fn(async () => {}),
  getEntitlementRow: vi.fn(async () => ({
    plan: 'free',
    stripeCustomerId: null,
  })),
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class {
    send = vi.fn(async () => ({}));
  },
  AdminDeleteUserCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  AdminUserGlobalSignOutCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

const {
  ACCOUNT_DELETE_CONFIRM_PHRASE,
  handleAccountEraseConfirm,
  handleAccountErasePropose,
} = await import('./accountErase.js');

type Row = Record<string, unknown>;

function fakeDb(state: {
  proposals?: Row[];
  counts?: { projects?: number; keys?: number; connectors?: number };
}) {
  const proposals = state.proposals ?? [];
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/FROM projects/.test(sql) && /count/.test(sql)) {
        return { rows: [{ n: String(state.counts?.projects ?? 0) }] };
      }
      if (/FROM api_keys/.test(sql) && /count/.test(sql)) {
        return { rows: [{ n: String(state.counts?.keys ?? 0) }] };
      }
      if (/FROM connectors/.test(sql) && /count/.test(sql)) {
        return { rows: [{ n: String(state.counts?.connectors ?? 0) }] };
      }
      if (/UPDATE account_erase_requests/.test(sql) && /cancelled/.test(sql)) {
        return { rows: [] };
      }
      if (/INSERT INTO account_erase_requests/.test(sql)) {
        const id = '11111111-1111-1111-8111-111111111111';
        proposals.push({
          id,
          owner_id: params?.[0],
          expected_email: params?.[1],
          confirm_phrase: params?.[2],
          status: 'proposed',
          expires_at: new Date(Date.now() + 60_000),
        });
        return { rows: [{ id }] };
      }
      if (/INSERT INTO account_audit/.test(sql)) {
        return { rows: [] };
      }
      if (/FROM account_erase_requests/.test(sql) && /SELECT/.test(sql)) {
        const id = params?.[0];
        const row = proposals.find((p) => p.id === id);
        return { rows: row ? [row] : [] };
      }
      if (/UPDATE account_erase_requests/.test(sql)) {
        const id = params?.[0];
        const row = proposals.find((p) => p.id === id);
        if (row && /expired/.test(sql)) row.status = 'expired';
        if (row && /completed/.test(sql)) {
          row.status = 'completed';
          row.expected_email = '[erased]';
        }
        if (row && /failed/.test(sql)) row.status = 'failed';
        if (row && /expected_email = \$2/.test(sql) && params?.[1] === '[erased]') {
          row.expected_email = '[erased]';
        }
        // Bulk pseudonymize by owner
        if (/expected_email = \$2/.test(sql) && !/status = 'completed'/.test(sql)) {
          for (const p of proposals) {
            if (p.owner_id === params?.[0]) p.expected_email = '[erased]';
          }
        }
        return { rows: [] };
      }
      if (/UPDATE api_keys/.test(sql)) return { rows: [] };
      if (/DELETE FROM/.test(sql)) return { rows: [] };
      if (/SELECT id FROM projects/.test(sql)) return { rows: [] };
      if (/UPDATE projects/.test(sql)) return { rows: [] };
      if (/UPDATE credit_balances/.test(sql)) return { rows: [] };
      if (/UPDATE workspaces/.test(sql)) return { rows: [] };
      if (/UPDATE page_captures/.test(sql)) return { rows: [] };
      if (/UPDATE messages/.test(sql)) return { rows: [] };
      if (/UPDATE sessions/.test(sql)) return { rows: [] };
      if (/UPDATE build_events/.test(sql)) return { rows: [] };
      if (/UPDATE project_document/.test(sql)) return { rows: [] };
      if (/DELETE FROM project_secret_keys/.test(sql)) return { rows: [] };
      if (/UPDATE creative_assets/.test(sql)) return { rows: [] };
      if (/UPDATE video_jobs/.test(sql)) return { rows: [] };
      if (/UPDATE code_artefacts/.test(sql)) return { rows: [] };
      if (/UPDATE shared_skills/.test(sql)) return { rows: [] };
      if (/UPDATE workflow_runs/.test(sql)) return { rows: [] };
      if (/UPDATE agent_runs/.test(sql)) return { rows: [] };
      if (/UPDATE connectors/.test(sql)) return { rows: [] };
      if (/UPDATE entitlements/.test(sql)) return { rows: [] };
      return { rows: [] };
    }),
    close: vi.fn(async () => {}),
  };
}

function body(res: { body: string }): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>;
}

describe('account erase propose → confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COGNITO_USER_POOL_ID;
    process.env.ALLOW_DEV_AUTH = 'true';
  });

  it('rejects anonymous propose', async () => {
    const db = fakeDb({});
    const res = await handleAccountErasePropose(
      db as never,
      { ownerId: 'anon', isAnonymous: true, source: 'dev' },
      JSON.stringify({ email: 'a@b.c' }),
    );
    expect(res.statusCode).toBe(401);
  });

  it('requires a valid email on propose', async () => {
    const db = fakeDb({});
    const res = await handleAccountErasePropose(
      db as never,
      { ownerId: 'u1', isAnonymous: false, source: 'jwt' },
      JSON.stringify({ email: 'nope' }),
    );
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toBe('email_required');
  });

  it('creates a proposal with confirm phrase and summary', async () => {
    const db = fakeDb({ counts: { projects: 2, keys: 1, connectors: 0 } });
    const res = await handleAccountErasePropose(
      db as never,
      { ownerId: 'u1', isAnonymous: false, source: 'jwt' },
      JSON.stringify({ email: 'Alex@Example.com' }),
    );
    expect(res.statusCode).toBe(200);
    const b = body(res);
    expect(b.confirmPhrase).toBe(ACCOUNT_DELETE_CONFIRM_PHRASE);
    expect(b.proposalId).toBeTruthy();
    expect((b.summary as { projects: number }).projects).toBe(2);
  });

  it('rejects confirm when phrase mismatches', async () => {
    const proposals: Row[] = [
      {
        id: '11111111-1111-1111-8111-111111111111',
        owner_id: 'u1',
        expected_email: 'a@b.c',
        confirm_phrase: ACCOUNT_DELETE_CONFIRM_PHRASE,
        status: 'proposed',
        expires_at: new Date(Date.now() + 60_000),
      },
    ];
    const db = fakeDb({ proposals });
    const res = await handleAccountEraseConfirm(
      db as never,
      { ownerId: 'u1', isAnonymous: false, source: 'jwt' },
      JSON.stringify({
        proposalId: proposals[0]!.id,
        email: 'a@b.c',
        confirmPhrase: 'delete',
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toBe('confirm_mismatch');
  });

  it('executes erase when email and phrase match', async () => {
    const proposals: Row[] = [
      {
        id: '11111111-1111-1111-8111-111111111111',
        owner_id: 'u1',
        expected_email: 'a@b.c',
        confirm_phrase: ACCOUNT_DELETE_CONFIRM_PHRASE,
        status: 'proposed',
        expires_at: new Date(Date.now() + 60_000),
      },
    ];
    const db = fakeDb({ proposals });
    const res = await handleAccountEraseConfirm(
      db as never,
      { ownerId: 'u1', isAnonymous: false, source: 'jwt' },
      JSON.stringify({
        proposalId: proposals[0]!.id,
        email: 'A@B.C',
        confirmPhrase: ACCOUNT_DELETE_CONFIRM_PHRASE,
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(body(res).ok).toBe(true);
    expect(body(res).stripeCustomerDeleted).toBe(false);
    expect(body(res).messagesRedacted).toBe(0);
    expect(proposals[0]!.status).toBe('completed');
    expect(proposals[0]!.expected_email).toBe('[erased]');
  });
});
