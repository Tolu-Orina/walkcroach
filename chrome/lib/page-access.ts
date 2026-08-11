/**
 * Page-access state machine (Phase A3).
 *
 * Replaces the single misleading string "no active tab — click the WalkCroach
 * toolbar icon on the page first", which told the user to perform a gesture that
 * does not fix anything: the toolbar click grants `activeTab` momentarily, but
 * the *next* click inside the side panel does not qualify, so the error returned.
 *
 * Every state below names the one action that actually resolves it, so the panel
 * can render a button instead of an apology.
 */

import {
  originPatternFromUrl,
  originLabel,
  restrictedReason,
  type RestrictedReason,
} from './permissions';

export type PageAccess =
  /** Granted (or activeTab-warm): we may extract on an explicit user action. */
  | {
      status: 'ready';
      tabId: number;
      url: string;
      title: string;
      origin: string;
    }
  /** Readable in principle, but the user has not granted this origin yet. */
  | {
      status: 'needs-grant';
      tabId: number;
      url: string;
      title: string;
      origin: string;
    }
  /** Chrome will never let an extension read this page. */
  | {
      status: 'restricted';
      tabId: number;
      url: string;
      reason: RestrictedReason;
    }
  /**
   * A tab is focused but its URL is invisible to us — no host grant for it and
   * no live `activeTab` window. Resolved by one toolbar click, after which we
   * learn the origin and can offer a permanent grant.
   */
  | { status: 'unknown'; tabId: number }
  /** No focused tab at all (e.g. panel open over the New Tab page / devtools). */
  | { status: 'no-tab' };

export type TabLike = {
  id?: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
};

/**
 * Classify the focused tab. `hasOrigin` is injected so this stays a pure
 * function that unit tests can drive without a chrome mock.
 */
export async function resolvePageAccess(
  tab: TabLike | undefined,
  hasOrigin: (originPattern: string) => Promise<boolean>,
): Promise<PageAccess> {
  if (!tab?.id) return { status: 'no-tab' };
  const tabId = tab.id;
  const url = tab.url ?? tab.pendingUrl;

  // Without `tabs` permission, `url` is only populated when we hold a host grant
  // for the tab or activeTab is live. An empty URL is therefore a permission
  // signal, not a missing tab.
  if (!url) return { status: 'unknown', tabId };

  const reason = restrictedReason(url);
  if (reason) return { status: 'restricted', tabId, url, reason };

  const origin = originPatternFromUrl(url);
  if (!origin) {
    return { status: 'restricted', tabId, url, reason: 'unparseable' };
  }

  const title = tab.title ?? '';
  return (await hasOrigin(origin))
    ? { status: 'ready', tabId, url, title, origin }
    : { status: 'needs-grant', tabId, url, title, origin };
}

export type PageAccessNotice = {
  /** Sentence shown above the actions. */
  message: string;
  /** Label for the button that resolves the state, when one exists. */
  action: 'grant' | 'retry' | null;
  actionLabel?: string;
  /** True when this is a dead end rather than something the user can fix here. */
  terminal: boolean;
};

const RESTRICTED_COPY: Record<RestrictedReason, string> = {
  scheme:
    'Chrome blocks extensions on browser pages. Switch to a normal http(s) tab and WalkCroach will pick it up.',
  webstore:
    'Chrome blocks extensions on the Web Store. Switch to a normal http(s) tab and WalkCroach will pick it up.',
  'local-file':
    'WalkCroach cannot read local files. Enable "Allow access to file URLs" on chrome://extensions if you need this, then reopen the panel.',
  unparseable:
    'This tab has an address WalkCroach cannot read. Switch to a normal http(s) tab and try again.',
};

/** User-facing copy + the single next action for each state. */
export function describePageAccess(access: PageAccess): PageAccessNotice {
  switch (access.status) {
    case 'ready':
      return { message: '', action: null, terminal: false };
    case 'needs-grant':
      return {
        message: `WalkCroach needs your OK to read ${originLabel(
          access.origin,
        )}. It reads the page only when you click an action, and you can revoke this any time under Account → Sites.`,
        action: 'grant',
        actionLabel: `Allow on ${originLabel(access.origin)}`,
        terminal: false,
      };
    case 'restricted':
      return {
        message: RESTRICTED_COPY[access.reason],
        action: null,
        terminal: true,
      };
    case 'unknown':
      return {
        message:
          'Click the WalkCroach icon in the toolbar once so it can see this tab. After that you can allow the site permanently and never do this again.',
        action: 'retry',
        actionLabel: 'Check this tab again',
        terminal: false,
      };
    case 'no-tab':
      return {
        message:
          'No page is focused. Open a normal http(s) tab, then check again.',
        action: 'retry',
        actionLabel: 'Check again',
        terminal: false,
      };
  }
}

/** Short chip text for the context header (no page content involved). */
export function pageAccessSummary(access: PageAccess): string {
  switch (access.status) {
    case 'ready':
    case 'needs-grant':
      return access.title || originLabel(access.origin);
    case 'restricted':
      return 'Restricted page';
    case 'unknown':
      return 'Tab not visible yet';
    case 'no-tab':
      return 'No page focused';
  }
}

export function canAct(access: PageAccess | null): boolean {
  return access?.status === 'ready';
}
