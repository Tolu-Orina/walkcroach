import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthContext } from '../auth.js';

/**
 * Guard-clause coverage for the two handlers the audit flagged as untested
 * (Phase D7). These are the security-relevant paths: who may link a Web project,
 * and what proof is required to merge an anonymous device into an account.
 *
 * The database is mocked with a queue of canned results rather than a live
 * CockroachDB, so these run in CI without credentials. The full round-trip is
 * covered separately by `chrome-api.integration.test.ts`, which skips without a
 * connection string.
 */

type QueryResult = { rows: unknown[] };
const queue: QueryResult[] = [];
const queries: Array<{ sql: string; params: unknown[] }> = [];
const closed = { count: 0 };

const fakeQuery = async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  return queue.shift() ?? { rows: [] };
};

vi.mock('@walkcroach/db', () => ({
  createDbClient: () => ({
    query: fakeQuery,
    // Mirrors the real client: statements run on one dedicated connection and
    // land in the same `queries` log, so assertions are unaffected by whether a
    // handler uses db.query or db.withTransaction.
    withTransaction: async (fn: (tx: { query: typeof fakeQuery }) => unknown) =>
      fn({ query: fakeQuery }),
    close: async () => {
      closed.count++;
    },
  }),
}));

vi.mock('./llm.js', () => ({
  embedText: async () => new Array(1024).fill(0),
  formatVector: () => '[0]',
}));

const { handleLinkWorkspace } = await import('./link.js');
const { handleUpgradeAuth } = await import('./upgrade.js');

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

function body(res: { body: string }): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>;
}

beforeEach(() => {
  queue.length = 0;
  queries.length = 0;
  closed.count = 0;
});

describe('handleLinkWorkspace — who may link', () => {
  it('refuses a device session', async () => {
    // Linking exposes Chrome captures inside a Web project, so it needs a real
    // account — an anonymous device has no project to link to.
    const res = await handleLinkWorkspace(device, 'ws-1', '{}');
    expect(res.statusCode).toBe(401);
    expect(body(res).error).toMatch(/Cognito sign-in required/);
  });

  it('refuses an anonymous jwt session', async () => {
    const res = await handleLinkWorkspace(
      { ...cognito, isAnonymous: true },
      'ws-1',
      '{}',
    );
    expect(res.statusCode).toBe(401);
  });

  it('never touches the database when refusing', async () => {
    await handleLinkWorkspace(device, 'ws-1', '{}');
    expect(queries).toHaveLength(0);
  });

  it('rejects a malformed body', async () => {
    const res = await handleLinkWorkspace(cognito, 'ws-1', '{ not json');
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toBe('invalid JSON body');
  });

  it('404s a workspace the caller does not own', async () => {
    queue.push({ rows: [] });
    const res = await handleLinkWorkspace(cognito, 'ws-1', '{}');
    expect(res.statusCode).toBe(404);
    // Ownership is enforced in SQL, not after the fact.
    expect(queries[0]!.sql).toMatch(/owner_id\s*=\s*\$2/);
    expect(queries[0]!.params).toEqual(['ws-1', 'cognito-sub-1']);
  });
});

describe('handleLinkWorkspace — unlink', () => {
  it('clears the link and detaches captures from the project', async () => {
    queue.push({ rows: [{ id: 'ws-1', linked_project_id: 'proj-1' }] });
    queue.push({ rows: [] }); // captures in workspace

    const res = await handleLinkWorkspace(cognito, 'ws-1', '{"projectId":null}');
    expect(res.statusCode).toBe(200);
    expect(body(res).linkedProjectId).toBeNull();

    const sql = queries.map((q) => q.sql).join('\n');
    expect(sql).toMatch(/SET linked_project_id = NULL/);
    expect(sql).toMatch(/SET project_id = NULL/);
  });

  it('treats an empty string and a missing projectId as unlink', async () => {
    for (const payload of ['{"projectId":""}', '{}']) {
      queue.length = 0;
      queries.length = 0;
      queue.push({ rows: [{ id: 'ws-1', linked_project_id: null }] });
      queue.push({ rows: [] });
      const res = await handleLinkWorkspace(cognito, 'ws-1', payload);
      expect(body(res).linkedProjectId, payload).toBeNull();
    }
  });

  it('always closes the connection', async () => {
    queue.push({ rows: [{ id: 'ws-1', linked_project_id: null }] });
    queue.push({ rows: [] });
    await handleLinkWorkspace(cognito, 'ws-1', '{}');
    expect(closed.count).toBe(1);
  });
});

describe('handleUpgradeAuth — proof required', () => {
  it('refuses anything but a Cognito token', async () => {
    for (const source of ['device', 'dev'] as const) {
      const res = await handleUpgradeAuth({ ...cognito, source }, '{}');
      expect(res.statusCode, source).toBe(400);
      expect(body(res).error).toMatch(/Cognito access token required/);
    }
  });

  it('rejects a malformed body', async () => {
    const res = await handleUpgradeAuth(cognito, '{ nope');
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toBe('invalid JSON body');
  });

  it('requires the anonymous owner id being claimed', async () => {
    const res = await handleUpgradeAuth(cognito, '{"deviceKey":"0123456789abcdef"}');
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toMatch(/anonOwnerId required/);
  });

  it('requires a device key, and a long one', async () => {
    // The device key is the only proof the caller actually owns the anonymous
    // data being merged; a short one must never be accepted.
    const short = await handleUpgradeAuth(
      cognito,
      '{"anonOwnerId":"anon:device:abc","deviceKey":"tooshort"}',
    );
    expect(short.statusCode).toBe(400);
    expect(body(short).error).toMatch(/deviceKey required/);

    const missing = await handleUpgradeAuth(
      cognito,
      '{"anonOwnerId":"anon:device:abc"}',
    );
    expect(missing.statusCode).toBe(400);
  });

  it('never touches the database when validation fails', async () => {
    await handleUpgradeAuth(cognito, '{"anonOwnerId":"anon:device:abc"}');
    expect(queries).toHaveLength(0);
  });

  it('rejects a device key that matches no session', async () => {
    queue.push({ rows: [] });
    const res = await handleUpgradeAuth(
      cognito,
      '{"anonOwnerId":"anon:device:abc","deviceKey":"0123456789abcdef"}',
    );
    expect(res.statusCode).toBe(403);
    expect(body(res).error).toMatch(/does not match/);
  });

  it('looks the session up by hash, never by the raw key', async () => {
    queue.push({ rows: [] });
    await handleUpgradeAuth(
      cognito,
      '{"anonOwnerId":"anon:device:abc","deviceKey":"0123456789abcdef"}',
    );
    expect(queries[0]!.sql).toMatch(/device_key_hash/);
    expect(queries[0]!.params[0]).not.toBe('0123456789abcdef');
    expect(String(queries[0]!.params[0])).toMatch(/^[0-9a-f]{32,}$/);
  });
});
