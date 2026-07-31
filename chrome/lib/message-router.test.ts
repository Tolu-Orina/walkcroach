import { describe, it, expect, beforeEach, vi } from 'vitest';
import { routeMessage, type RouterDeps } from './message-router';
import type { PageAccess } from './page-access';
import type { PageExtract } from './extract';

/**
 * The panel ↔ worker message router (Phase G1).
 *
 * This is every path by which page content, a screenshot, or a queued selection
 * can leave the page. It was at 0% coverage and not even in the coverage report,
 * because the worker is a WXT entrypoint that cannot be imported from a test.
 *
 * The property these tests exist to hold: **nothing is read before access is
 * checked**, and a screenshot is gated more strictly than page text.
 */

const extract = (url: string): PageExtract => ({
  url,
  title: 'Quote',
  extractedText: 'body',
  contentHash: 'fnv:1',
});

const ready: PageAccess = {
  status: 'ready',
  tabId: 7,
  url: 'https://acme.test/q',
  title: 'Quote',
  origin: 'https://acme.test/*',
};
const needsGrant: PageAccess = { ...ready, status: 'needs-grant' };
const unknown: PageAccess = { status: 'unknown', tabId: 7 };
const restricted: PageAccess = {
  status: 'restricted',
  tabId: 7,
  url: 'chrome://settings',
  reason: 'scheme',
};
const noTab: PageAccess = { status: 'no-tab' };

let deps: RouterDeps;
let access: PageAccess;

beforeEach(() => {
  access = ready;
  deps = {
    getAccess: vi.fn(async () => access),
    extract: vi.fn(async () => extract('https://acme.test/q')),
    readCache: vi.fn(async () => null),
    writeCache: vi.fn(async () => {}),
    clearCache: vi.fn(async () => {}),
    listGrants: vi.fn(async () => ['https://acme.test/*']),
    insertDraft: vi.fn(async () => ({ inserted: true })),
    takeSelection: vi.fn(async () => null),
    captureScreenshot: vi.fn(async () => ({
      dataUrl: 'data:image/jpeg;base64,AAA',
      width: 1200,
      height: 700,
      base64Length: 3,
    })),
  };
});

describe('unknown messages', () => {
  it('are refused rather than silently ignored', async () => {
    const res = await routeMessage(
      { type: 'NOT_A_REAL_TYPE' } as never,
      deps,
    );
    expect(res).toEqual({ ok: false, error: 'unhandled' });
  });

  it('PING never touches the page', async () => {
    const res = await routeMessage({ type: 'PING' }, deps);
    expect(res).toEqual({ ok: true, pong: true });
    expect(deps.getAccess).not.toHaveBeenCalled();
    expect(deps.extract).not.toHaveBeenCalled();
  });
});

describe('GET_PAGE_CONTEXT', () => {
  it('classifies the tab without reading it', async () => {
    const res = await routeMessage({ type: 'GET_PAGE_CONTEXT' }, deps);
    expect(res).toEqual({ ok: true, access: ready });
    // The panel calls this on every tab change; it must never cost an extract.
    expect(deps.extract).not.toHaveBeenCalled();
  });
});

describe('GET_ACTIVE_EXTRACT — the main read path', () => {
  it('serves a cache hit without re-scripting the page', async () => {
    const cached = extract('https://acme.test/q');
    deps.readCache = vi.fn(async () => cached);
    const res = await routeMessage({ type: 'GET_ACTIVE_EXTRACT' }, deps);
    expect(res).toMatchObject({ ok: true, cached: true, extract: cached });
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it('extracts and caches on a miss', async () => {
    const res = await routeMessage({ type: 'GET_ACTIVE_EXTRACT' }, deps);
    expect(res).toMatchObject({ ok: true, cached: false });
    expect(deps.writeCache).toHaveBeenCalledWith(7, expect.anything());
  });

  it('refuses a restricted page without attempting to read it', async () => {
    access = restricted;
    const res = await routeMessage({ type: 'GET_ACTIVE_EXTRACT' }, deps);
    expect(res).toEqual({ ok: false, access: restricted });
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it('refuses when there is no tab', async () => {
    access = noTab;
    const res = await routeMessage({ type: 'GET_ACTIVE_EXTRACT' }, deps);
    expect(res).toEqual({ ok: false, access: noTab });
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it('never consults the cache for an ungranted origin', async () => {
    // Cache is only trusted in `ready`. Serving it on `needs-grant` would return
    // page text for a site whose permission was withdrawn.
    access = needsGrant;
    await routeMessage({ type: 'GET_ACTIVE_EXTRACT' }, deps);
    expect(deps.readCache).not.toHaveBeenCalled();
  });

  it('still attempts once on needs-grant, since activeTab may be live', async () => {
    access = needsGrant;
    const res = await routeMessage({ type: 'GET_ACTIVE_EXTRACT' }, deps);
    expect(deps.extract).toHaveBeenCalledWith(7);
    expect(res).toMatchObject({ ok: true });
  });

  it('reports failure with the access state when extraction returns nothing', async () => {
    deps.extract = vi.fn(async () => null);
    const res = await routeMessage({ type: 'GET_ACTIVE_EXTRACT' }, deps);
    expect(res).toEqual({ ok: false, access: ready });
    expect(deps.writeCache).not.toHaveBeenCalled();
  });
});

describe('WARM_PAGE_CONTEXT', () => {
  it('never reports an error — a failed warm is not the user’s problem', async () => {
    access = restricted;
    const res = await routeMessage({ type: 'WARM_PAGE_CONTEXT' }, deps);
    expect(res).toMatchObject({ ok: true, warmed: false });
  });

  it('spends a live activeTab window when the url is hidden', async () => {
    access = unknown;
    const res = await routeMessage({ type: 'WARM_PAGE_CONTEXT' }, deps);
    expect(deps.extract).toHaveBeenCalledWith(7);
    expect(res).toMatchObject({ warmed: true });
  });

  it('does not re-extract when the cache is already warm', async () => {
    deps.readCache = vi.fn(async () => extract('https://acme.test/q'));
    const res = await routeMessage({ type: 'WARM_PAGE_CONTEXT' }, deps);
    expect(res).toMatchObject({ warmed: true });
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it('does not warm on a needs-grant origin', async () => {
    // Warming runs on panel open, with no user action — extracting here would
    // read a page the user has not allowed.
    access = needsGrant;
    const res = await routeMessage({ type: 'WARM_PAGE_CONTEXT' }, deps);
    expect(deps.extract).not.toHaveBeenCalled();
    expect(res).toMatchObject({ warmed: false });
  });
});

describe('CAPTURE_SCREENSHOT — stricter than page text', () => {
  it('captures on an allowed site', async () => {
    const res = await routeMessage({ type: 'CAPTURE_SCREENSHOT' }, deps);
    expect(res).toMatchObject({ ok: true });
    expect(deps.captureScreenshot).toHaveBeenCalledWith(7);
  });

  it('refuses on needs-grant, where extraction would still try', async () => {
    // The deliberate asymmetry: an image of the screen shows whatever else is
    // on it, so it is only ever taken on a site the user has allowed.
    access = needsGrant;
    const res = await routeMessage({ type: 'CAPTURE_SCREENSHOT' }, deps);
    expect(res).toEqual({ ok: false, access: needsGrant });
    expect(deps.captureScreenshot).not.toHaveBeenCalled();
  });

  it('refuses on unknown, restricted and no-tab', async () => {
    for (const state of [unknown, restricted, noTab]) {
      access = state;
      const res = await routeMessage({ type: 'CAPTURE_SCREENSHOT' }, deps);
      expect(res, state.status).toEqual({ ok: false, access: state });
    }
    expect(deps.captureScreenshot).not.toHaveBeenCalled();
  });

  it('reports a Chrome refusal without throwing', async () => {
    deps.captureScreenshot = vi.fn(async () => {
      throw new Error('Cannot access contents of the page');
    });
    const res = await routeMessage({ type: 'CAPTURE_SCREENSHOT' }, deps);
    expect(res).toMatchObject({
      ok: false,
      error: 'Cannot access contents of the page',
    });
  });

  it('reports an encode failure distinctly from a permission failure', async () => {
    deps.captureScreenshot = vi.fn(async () => null);
    const res = await routeMessage({ type: 'CAPTURE_SCREENSHOT' }, deps);
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/encode/);
  });
});

describe('INSERT_DRAFT', () => {
  it('requires text', async () => {
    const res = await routeMessage({ type: 'INSERT_DRAFT', payload: {} }, deps);
    expect(res).toEqual({ ok: false, error: 'text required' });
    expect(deps.getAccess).not.toHaveBeenCalled();
  });

  it('inserts into an allowed page', async () => {
    const res = await routeMessage(
      { type: 'INSERT_DRAFT', payload: { text: 'hello' } },
      deps,
    );
    expect(res).toEqual({ ok: true });
    expect(deps.insertDraft).toHaveBeenCalledWith(7, 'hello');
  });

  it('surfaces the page-side reason when there is no focused field', async () => {
    deps.insertDraft = vi.fn(async () => ({
      inserted: false,
      reason: 'no focused field',
    }));
    const res = await routeMessage(
      { type: 'INSERT_DRAFT', payload: { text: 'hi' } },
      deps,
    );
    expect(res).toMatchObject({ ok: false, error: 'no focused field' });
  });

  it('refuses on a restricted page without attempting injection', async () => {
    access = restricted;
    const res = await routeMessage(
      { type: 'INSERT_DRAFT', payload: { text: 'hi' } },
      deps,
    );
    expect(res).toEqual({ ok: false, access: restricted });
    expect(deps.insertDraft).not.toHaveBeenCalled();
  });

  it('reports lost access rather than throwing when injection fails', async () => {
    deps.insertDraft = vi.fn(async () => {
      throw new Error('no access');
    });
    const res = await routeMessage(
      { type: 'INSERT_DRAFT', payload: { text: 'hi' } },
      deps,
    );
    expect(res).toMatchObject({ ok: false, needsAccess: true });
  });
});

describe('grants and cache', () => {
  it('lists granted origins', async () => {
    const res = await routeMessage({ type: 'GET_GRANTED_ORIGINS' }, deps);
    expect(res).toEqual({ ok: true, origins: ['https://acme.test/*'] });
  });

  it('reports the list after a revoke, which the panel performs', async () => {
    // Revoking needs a user gesture, so the worker only re-reports.
    const res = await routeMessage({ type: 'REVOKE_ORIGIN' }, deps);
    expect(res).toEqual({ ok: true, origins: ['https://acme.test/*'] });
  });

  it('clears one tab when given an id', async () => {
    await routeMessage({ type: 'CLEAR_PAGE_CACHE', payload: { tabId: 3 } }, deps);
    expect(deps.clearCache).toHaveBeenCalledWith(3);
  });

  it('clears everything when given none', async () => {
    await routeMessage({ type: 'CLEAR_PAGE_CACHE' }, deps);
    expect(deps.clearCache).toHaveBeenCalledWith(undefined);
  });
});

describe('TAKE_PENDING_SELECTION', () => {
  it('passes through the queued selection', async () => {
    const selection = {
      text: 'eighteen working days',
      url: 'https://acme.test/q',
      title: 'Quote',
      truncated: false,
      capturedAt: 1,
    };
    deps.takeSelection = vi.fn(async () => selection);
    const res = await routeMessage({ type: 'TAKE_PENDING_SELECTION' }, deps);
    expect(res).toEqual({ ok: true, selection });
  });

  it('reports null when nothing is queued', async () => {
    const res = await routeMessage({ type: 'TAKE_PENDING_SELECTION' }, deps);
    expect(res).toEqual({ ok: true, selection: null });
  });
});
