import { describe, it, expect, vi } from 'vitest';
import {
  canAct,
  describePageAccess,
  pageAccessSummary,
  resolvePageAccess,
  type PageAccess,
} from './page-access';

const granted = async () => true;
const notGranted = async () => false;

describe('resolvePageAccess', () => {
  it('is ready when the origin is already granted', async () => {
    const access = await resolvePageAccess(
      { id: 7, url: 'https://example.com/jobs/1', title: 'Job' },
      granted,
    );
    expect(access).toEqual({
      status: 'ready',
      tabId: 7,
      url: 'https://example.com/jobs/1',
      title: 'Job',
      origin: 'https://example.com/*',
    });
  });

  it('needs a grant when the origin is readable but ungranted', async () => {
    const access = await resolvePageAccess(
      { id: 7, url: 'https://example.com/a', title: 'A' },
      notGranted,
    );
    expect(access.status).toBe('needs-grant');
    expect(access).toMatchObject({ origin: 'https://example.com/*' });
  });

  it('reports no-tab when there is no focused tab', async () => {
    await expect(resolvePageAccess(undefined, granted)).resolves.toEqual({
      status: 'no-tab',
    });
    await expect(resolvePageAccess({}, granted)).resolves.toEqual({
      status: 'no-tab',
    });
  });

  it('treats a hidden URL as a permission signal, not a missing tab', async () => {
    // Without `tabs` and without a host grant, Chrome blanks Tab.url. That is
    // the state one toolbar click resolves — it is not "no active tab".
    await expect(resolvePageAccess({ id: 3 }, granted)).resolves.toEqual({
      status: 'unknown',
      tabId: 3,
    });
  });

  it('falls back to pendingUrl while a tab is still navigating', async () => {
    const access = await resolvePageAccess(
      { id: 3, pendingUrl: 'https://example.com/next' },
      granted,
    );
    expect(access.status).toBe('ready');
  });

  it('marks browser and store pages restricted with a reason', async () => {
    const chromePage = await resolvePageAccess(
      { id: 1, url: 'chrome://settings' },
      granted,
    );
    expect(chromePage).toMatchObject({ status: 'restricted', reason: 'scheme' });

    const store = await resolvePageAccess(
      { id: 1, url: 'https://chromewebstore.google.com/detail/x' },
      granted,
    );
    expect(store).toMatchObject({ status: 'restricted', reason: 'webstore' });

    const file = await resolvePageAccess(
      { id: 1, url: 'file:///tmp/a.html' },
      granted,
    );
    expect(file).toMatchObject({
      status: 'restricted',
      reason: 'local-file',
    });
  });

  it('does not consult the permission API for restricted pages', async () => {
    const hasOrigin = vi.fn(async () => true);
    await resolvePageAccess({ id: 1, url: 'chrome://settings' }, hasOrigin);
    expect(hasOrigin).not.toHaveBeenCalled();
  });
});

describe('describePageAccess', () => {
  it('says nothing when the page is ready', () => {
    const notice = describePageAccess({
      status: 'ready',
      tabId: 1,
      url: 'https://example.com/',
      title: 'T',
      origin: 'https://example.com/*',
    });
    expect(notice.message).toBe('');
    expect(notice.action).toBeNull();
  });

  it('offers a grant button naming the site', () => {
    const notice = describePageAccess({
      status: 'needs-grant',
      tabId: 1,
      url: 'https://acme.test/a',
      title: 'T',
      origin: 'https://acme.test/*',
    });
    expect(notice.action).toBe('grant');
    expect(notice.actionLabel).toBe('Allow on acme.test');
    expect(notice.message).toContain('acme.test');
    expect(notice.terminal).toBe(false);
  });

  it('marks restricted pages terminal with no action', () => {
    const notice = describePageAccess({
      status: 'restricted',
      tabId: 1,
      url: 'chrome://settings',
      reason: 'scheme',
    });
    expect(notice.terminal).toBe(true);
    expect(notice.action).toBeNull();
  });

  it('never tells the user to click the toolbar unless that actually helps', () => {
    // The old copy said this on every failure, including ones a toolbar click
    // could not fix. It now appears only in the `unknown` state.
    const states: PageAccess[] = [
      {
        status: 'needs-grant',
        tabId: 1,
        url: 'https://a.test/',
        title: '',
        origin: 'https://a.test/*',
      },
      { status: 'restricted', tabId: 1, url: 'chrome://x', reason: 'scheme' },
      { status: 'no-tab' },
    ];
    for (const state of states) {
      expect(describePageAccess(state).message).not.toMatch(/toolbar/i);
    }
    expect(
      describePageAccess({ status: 'unknown', tabId: 1 }).message,
    ).toMatch(/toolbar/i);
  });

  it('gives every non-ready state a next step', () => {
    const states: PageAccess[] = [
      {
        status: 'needs-grant',
        tabId: 1,
        url: 'https://a.test/',
        title: '',
        origin: 'https://a.test/*',
      },
      { status: 'unknown', tabId: 1 },
      { status: 'no-tab' },
      { status: 'restricted', tabId: 1, url: 'chrome://x', reason: 'scheme' },
    ];
    for (const state of states) {
      const notice = describePageAccess(state);
      expect(notice.message).not.toBe('');
      // Either a button, or an explicit dead end that says what to do instead.
      expect(notice.action !== null || notice.terminal).toBe(true);
    }
  });
});

describe('pageAccessSummary / canAct', () => {
  it('prefers the page title, falling back to the host', () => {
    expect(
      pageAccessSummary({
        status: 'needs-grant',
        tabId: 1,
        url: 'https://acme.test/a',
        title: '',
        origin: 'https://acme.test/*',
      }),
    ).toBe('acme.test');
    expect(
      pageAccessSummary({
        status: 'ready',
        tabId: 1,
        url: 'https://acme.test/a',
        title: 'Quote #12',
        origin: 'https://acme.test/*',
      }),
    ).toBe('Quote #12');
  });

  it('only allows acting on a ready page', () => {
    expect(canAct(null)).toBe(false);
    expect(canAct({ status: 'unknown', tabId: 1 })).toBe(false);
    expect(
      canAct({
        status: 'ready',
        tabId: 1,
        url: 'https://a.test/',
        title: '',
        origin: 'https://a.test/*',
      }),
    ).toBe(true);
  });
});
