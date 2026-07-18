import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchHealth,
  createDeviceSession,
  streamSummarize,
  listWorkspaces,
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
  upgradeAuth,
  type AgentEvent,
} from './api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function ndjsonResponse(events: unknown[]): Response {
  const text = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(new TextEncoder().encode(text));
      ctrl.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('fetchHealth', () => {
  it('returns parsed health JSON', async () => {
    const body = { ok: true, service: 'walkcroach', version: '0.1.0' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(body));
    const result = await fetchHealth();
    expect(result).toEqual(body);
  });

  it('throws on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('fail', { status: 503 }),
    );
    await expect(fetchHealth()).rejects.toThrow('health failed: 503');
  });
});

describe('createDeviceSession', () => {
  it('posts without deviceKey when not provided', async () => {
    const body = {
      accessToken: 'tok',
      tokenType: 'Bearer',
      expiresIn: 3600,
      ownerId: 'owner-1',
    };
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(body));
    const result = await createDeviceSession();
    expect(result).toEqual(body);
    const call = spy.mock.calls[0];
    expect(JSON.parse(call[1]!.body as string)).toEqual({});
  });

  it('posts with deviceKey when provided', async () => {
    const body = {
      accessToken: 'tok',
      tokenType: 'Bearer',
      expiresIn: 3600,
      ownerId: 'owner-1',
      deviceKey: 'dk-123',
    };
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(body));
    await createDeviceSession('dk-123');
    const call = spy.mock.calls[0];
    expect(JSON.parse(call[1]!.body as string)).toEqual({ deviceKey: 'dk-123' });
  });

  it('throws on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('bad key', { status: 401 }),
    );
    await expect(createDeviceSession('bad')).rejects.toThrow('device session failed: 401');
  });
});

describe('streamSummarize (NDJSON)', () => {
  it('yields parsed events from stream', async () => {
    const events: AgentEvent[] = [
      { type: 'token', text: 'Hello' },
      { type: 'done', reason: 'complete' },
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ndjsonResponse(events));
    const collected: AgentEvent[] = [];
    for await (const ev of streamSummarize('tok', {
      url: 'https://example.com',
      title: 'Test',
      extractedText: 'text',
      contentHash: 'hash',
    })) {
      collected.push(ev);
    }
    expect(collected).toEqual(events);
  });

  it('yields error for malformed JSON lines', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode('not-json\n'));
        ctrl.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(stream, { status: 200 }),
    );
    const collected: AgentEvent[] = [];
    for await (const ev of streamSummarize('tok', {
      url: 'u',
      title: 't',
      extractedText: 'e',
      contentHash: 'c',
    })) {
      collected.push(ev);
    }
    expect(collected).toEqual([{ type: 'error', message: 'malformed stream chunk' }]);
  });

  it('handles chunked data split across reads', async () => {
    const line1 = JSON.stringify({ type: 'token', text: 'A' });
    const line2 = JSON.stringify({ type: 'done', reason: 'end' });
    const full = line1 + '\n' + line2 + '\n';
    const mid = Math.floor(full.length / 2);
    const chunk1 = new TextEncoder().encode(full.slice(0, mid));
    const chunk2 = new TextEncoder().encode(full.slice(mid));

    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(chunk1);
        ctrl.enqueue(chunk2);
        ctrl.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(stream, { status: 200 }),
    );
    const collected: AgentEvent[] = [];
    for await (const ev of streamSummarize('tok', {
      url: 'u',
      title: 't',
      extractedText: 'e',
      contentHash: 'c',
    })) {
      collected.push(ev);
    }
    expect(collected).toEqual([
      { type: 'token', text: 'A' },
      { type: 'done', reason: 'end' },
    ]);
  });

  it('throws when response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('server error', { status: 500 }),
    );
    const gen = streamSummarize('tok', {
      url: 'u',
      title: 't',
      extractedText: 'e',
      contentHash: 'c',
    });
    await expect(gen.next()).rejects.toThrow('server error');
  });

  it('stops when abort signal fires', async () => {
    const controller = new AbortController();
    const events: AgentEvent[] = [
      { type: 'token', text: 'A' },
      { type: 'token', text: 'B' },
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ndjsonResponse(events));

    const collected: AgentEvent[] = [];
    for await (const ev of streamSummarize(
      'tok',
      { url: 'u', title: 't', extractedText: 'e', contentHash: 'c' },
      controller.signal,
    )) {
      collected.push(ev);
      controller.abort();
    }
    expect(collected.length).toBeGreaterThanOrEqual(1);
  });

  it('handles trailing data after last newline', async () => {
    const trailing = JSON.stringify({ type: 'token', text: 'tail' });
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode(trailing));
        ctrl.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(stream, { status: 200 }),
    );
    const collected: AgentEvent[] = [];
    for await (const ev of streamSummarize('tok', {
      url: 'u',
      title: 't',
      extractedText: 'e',
      contentHash: 'c',
    })) {
      collected.push(ev);
    }
    expect(collected).toEqual([{ type: 'token', text: 'tail' }]);
  });
});

describe('listWorkspaces', () => {
  it('returns workspaces array', async () => {
    const ws = [
      { id: '1', name: 'WS', linked_project_id: null, created_at: '', updated_at: '' },
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ workspaces: ws }),
    );
    expect(await listWorkspaces('tok')).toEqual(ws);
  });

  it('throws on error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('denied', { status: 403 }),
    );
    await expect(listWorkspaces('tok')).rejects.toThrow('denied');
  });
});

describe('createWorkspace', () => {
  it('returns created workspace', async () => {
    const ws = { id: '2', name: 'New', linked_project_id: null, created_at: '', updated_at: '' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ workspace: ws }),
    );
    expect(await createWorkspace('tok', 'New')).toEqual(ws);
  });
});

describe('renameWorkspace', () => {
  it('returns renamed workspace', async () => {
    const ws = { id: '2', name: 'Renamed', linked_project_id: null, created_at: '', updated_at: '' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ workspace: ws }),
    );
    expect(await renameWorkspace('tok', '2', 'Renamed')).toEqual(ws);
  });
});

describe('deleteWorkspace', () => {
  it('resolves on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );
    await expect(deleteWorkspace('tok', '2')).resolves.toBeUndefined();
  });

  it('throws on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not found', { status: 404 }),
    );
    await expect(deleteWorkspace('tok', '999')).rejects.toThrow('not found');
  });
});

describe('upgradeAuth', () => {
  it('returns merge result', async () => {
    const result = { ok: true, merged: true, ownerId: 'cognito-sub' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(result));
    const out = await upgradeAuth('cognito-tok', 'anon-owner', 'dk-1');
    expect(out).toEqual(result);
  });

  it('throws on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('unauthorized', { status: 401 }),
    );
    await expect(upgradeAuth('bad', 'o', 'dk')).rejects.toThrow('unauthorized');
  });
});
