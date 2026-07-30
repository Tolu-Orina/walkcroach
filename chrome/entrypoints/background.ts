/**
 * Page extract + draft insert for the side panel.
 *
 * Permission model (v0.2.0): optional host permissions granted per origin from a
 * side-panel click, plus whatever `activeTab` window a toolbar click happens to
 * leave open. The worker never prompts — `chrome.permissions.request` must run in
 * a gesture-bearing context, so the panel owns that call (`lib/permissions.ts`).
 *
 * Narrow API host_permissions live in wxt.config (BFF fetch only).
 */
import {
  isAllowedMessage,
  isTrustedSender,
  type ExtensionMessage,
} from '../lib/messaging';
import type { PageExtract } from '../lib/extract';
import { MAX_EXTRACT_CHARS } from '../lib/extract';
import { hasOriginPermission, listGrantedOrigins } from '../lib/permissions';
import { resolvePageAccess, type PageAccess } from '../lib/page-access';
import { downscaleToJpeg, type CapturedScreenshot } from '../lib/screenshot';
import {
  isUsableSelection,
  normalizeSelection,
  putPendingSelection,
  takePendingSelection,
} from '../lib/selection';
import {
  clearAllCachedExtracts,
  clearCachedExtract,
  readCachedExtract,
  writeCachedExtract,
} from '../lib/extract-cache';

/** Built from entrypoints/extractor.ts — Readability, bundled, not a content script. */
const EXTRACTOR_FILE = 'extractor.js';

const CONTEXT_MENU_ID = 'walkcroach-open-for-page';
const SELECTION_MENU_ID = 'walkcroach-save-selection';
const PANEL_PORT = 'walkcroach-panel';

/**
 * Windows with an open side panel, used to make the toolbar click a toggle.
 *
 * Deliberately in-memory rather than storage: the panel holds a port with a
 * heartbeat, which keeps this worker alive for as long as it is open. So if the
 * worker restarted and this set is empty, the panel really is closed. The worst
 * case — a missed entry — is calling `open()` on an already-open panel, which is
 * harmless. Reading storage instead would cost an `await`, and an `await` before
 * `sidePanel.open()` spends the user gesture that authorises it.
 */
const openPanelWindows = new Set<number>();

export default defineBackground(() => {
  // No `setPanelBehavior({ openPanelOnActionClick: true })`.
  //
  // That setting makes Chrome swallow the toolbar click: `action.onClicked`
  // never fires, so we never observe the one moment `activeTab` is guaranteed —
  // which is why the warm cache used to be best-effort and why a page's URL
  // could stay invisible. Owning the click turns both into documented behaviour
  // ("executing an action" is on Chrome's activeTab list).
  chrome.runtime.onInstalled.addListener(() => {
    void clearAllCachedExtracts();
    // `create` throws if the id already exists (update/reload), so clear first.
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: 'Open WalkCroach for this page',
        contexts: ['page', 'link', 'image'],
      });
      // Selection gets its own item: saving a highlight is a different intent
      // from opening the panel, and it sends only the highlighted words.
      chrome.contextMenus.create({
        id: SELECTION_MENU_ID,
        title: 'Save selection to WalkCroach',
        contexts: ['selection'],
      });
    });
  });

  /**
   * Toolbar click and `Alt+Shift+W` both land here. Ordering is load-bearing:
   * `sidePanel.open()` requires the live user gesture, so it must run before the
   * first `await`. Extraction happens afterwards, on the `activeTab` grant this
   * same click just produced — and that grant persists on the tab until it
   * navigates, so the panel keeps the URL for the whole visit.
   */
  chrome.action.onClicked.addListener((tab) => {
    const tabId = tab.id;
    const windowId = tab.windowId;

    if (
      typeof windowId === 'number' &&
      openPanelWindows.has(windowId) &&
      closeSidePanel(windowId)
    ) {
      openPanelWindows.delete(windowId);
      return;
    }

    openSidePanel({ tabId, windowId });
    if (typeof tabId === 'number') void warmTab(tabId);
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === CONTEXT_MENU_ID) {
      openSidePanel({ tabId: tab?.id, windowId: tab?.windowId });
      if (typeof tab?.id === 'number') void warmTab(tab.id);
      return;
    }

    if (info.menuItemId === SELECTION_MENU_ID) {
      // Open first — `sidePanel.open()` needs the live gesture — then read the
      // selection on the activeTab grant this same click produced.
      openSidePanel({ tabId: tab?.id, windowId: tab?.windowId });
      void captureSelection(info, tab);
    }
  });

  /**
   * Panel liveness. The panel connects on mount and heartbeats; that keeps this
   * worker alive so `onDisconnect` reliably fires when the panel closes.
   */
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PANEL_PORT) return;
    if (port.sender?.id !== chrome.runtime.id) {
      port.disconnect();
      return;
    }
    let windowId: number | undefined;
    port.onMessage.addListener((msg: unknown) => {
      const id = (msg as { windowId?: number } | undefined)?.windowId;
      if (typeof id === 'number') {
        windowId = id;
        openPanelWindows.add(id);
      }
    });
    port.onDisconnect.addListener(() => {
      if (typeof windowId === 'number') openPanelWindows.delete(windowId);
    });
  });

  // Cached page text must not outlive the page it came from.
  chrome.tabs.onRemoved.addListener((tabId) => {
    void clearCachedExtract(tabId);
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) void clearCachedExtract(tabId);
  });
  // ...nor a site grant the user just withdrew.
  chrome.permissions.onRemoved.addListener(() => {
    void clearAllCachedExtracts();
  });

  chrome.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
      if (!isTrustedSender(sender) || !isAllowedMessage(message)) {
        sendResponse({ ok: false, error: 'rejected' });
        return false;
      }

      void handleMessage(message as ExtensionMessage).then(sendResponse);
      return true;
    },
  );
});

/**
 * `chrome.sidePanel.close()` landed in Chrome 141 and is not in our
 * `@types/chrome` yet. Feature-detected so that on an older Chrome the toolbar
 * click simply re-opens (Chrome's own pre-141 behaviour) instead of throwing.
 *
 * Returns whether the close was issued, so the caller knows if the toggle took.
 */
type SidePanelWithClose = typeof chrome.sidePanel & {
  close?: (options: { windowId: number }) => Promise<void>;
};

function closeSidePanel(windowId: number): boolean {
  const close = (chrome.sidePanel as SidePanelWithClose).close;
  if (typeof close !== 'function') return false;
  void close.call(chrome.sidePanel, { windowId }).catch(() => undefined);
  return true;
}

/**
 * Fire-and-forget so no `await` precedes it — see the ordering note above.
 * `tabId` is preferred; `windowId` is the fallback Chrome accepts.
 */
function openSidePanel(target: { tabId?: number; windowId?: number }): void {
  const options =
    typeof target.tabId === 'number'
      ? { tabId: target.tabId }
      : typeof target.windowId === 'number'
        ? { windowId: target.windowId }
        : null;
  if (!options) return;
  if (typeof target.windowId === 'number') {
    openPanelWindows.add(target.windowId);
  }
  void chrome.sidePanel.open(options).catch(() => {
    // Gesture expired or the panel is already open — both benign.
  });
}

/**
 * Read the user's highlighted text and queue it for the panel (Phase D3).
 *
 * Prefers `window.getSelection()` over `info.selectionText`: Chrome truncates the
 * latter at roughly 1k characters, which silently clips exactly the long quote a
 * user most wants to keep. Falls back to it when scripting is unavailable.
 */
async function captureSelection(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  const fallback = info.selectionText ?? '';
  let text = fallback;
  let truncated = Boolean(fallback);

  if (typeof tab?.id === 'number') {
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection()?.toString() ?? '',
      });
      const full = injected[0]?.result;
      if (typeof full === 'string' && full.trim().length > text.trim().length) {
        text = full;
        truncated = false;
      }
    } catch {
      // Restricted page or no access — the fallback still carries something.
    }
  }

  const normalized = normalizeSelection(text);
  if (!isUsableSelection(normalized)) return;

  await putPendingSelection({
    text: normalized,
    url: info.pageUrl ?? tab?.url ?? '',
    title: tab?.title ?? '',
    truncated,
    capturedAt: Date.now(),
  });
}

/** Spend a fresh activeTab grant on one extract, and keep it. */
async function warmTab(tabId: number): Promise<void> {
  try {
    const extract = await runExtract(tabId);
    if (extract) await writeCachedExtract(tabId, extract);
  } catch {
    // Restricted page or grant already gone — the panel will classify it.
  }
}

async function currentAccess(): Promise<PageAccess> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return resolvePageAccess(tab, hasOriginPermission);
}

async function handleMessage(
  message: ExtensionMessage,
): Promise<Record<string, unknown>> {
  switch (message.type) {
    case 'PING':
      return { ok: true, pong: true };

    case 'GET_PAGE_CONTEXT': {
      const access = await currentAccess();
      return { ok: true, access };
    }

    /**
     * Best-effort warm: spends a live `activeTab` window (or an existing grant)
     * once, so the panel is instant later. Silent on failure by design — this
     * runs on panel open, and a failure here is not a user-facing error.
     */
    case 'WARM_PAGE_CONTEXT': {
      const access = await currentAccess();
      if (access.status !== 'ready') {
        // activeTab may still be live even when tab.url was hidden; try anyway.
        if (access.status === 'unknown') {
          const extract = await runExtract(access.tabId);
          if (extract) {
            await writeCachedExtract(access.tabId, extract);
            return { ok: true, access, warmed: true };
          }
        }
        return { ok: true, access, warmed: false };
      }
      const cached = await readCachedExtract(access.tabId, access.url);
      if (cached) return { ok: true, access, warmed: true };
      const extract = await runExtract(access.tabId);
      if (extract) await writeCachedExtract(access.tabId, extract);
      return { ok: true, access, warmed: Boolean(extract) };
    }

    case 'GET_ACTIVE_TAB_INFO': {
      const access = await currentAccess();
      if (access.status === 'no-tab' || access.status === 'unknown') {
        return { ok: false, access };
      }
      if (access.status === 'restricted') {
        return { ok: false, access };
      }
      return {
        ok: true,
        access,
        tabId: access.tabId,
        url: access.url,
        title: access.title,
      };
    }

    case 'GET_ACTIVE_EXTRACT': {
      const access = await currentAccess();
      if (access.status === 'ready') {
        const cached = await readCachedExtract(access.tabId, access.url);
        if (cached) return { ok: true, access, extract: cached, cached: true };
      }
      if (access.status === 'no-tab' || access.status === 'restricted') {
        return { ok: false, access };
      }
      // 'needs-grant' and 'unknown' still get one attempt: a live activeTab
      // window can satisfy them, and succeeding beats a correct refusal.
      const extract = await runExtract(access.tabId);
      if (!extract) return { ok: false, access };
      await writeCachedExtract(access.tabId, extract);
      return { ok: true, access, extract, cached: false };
    }

    case 'INSERT_DRAFT': {
      const text = (message.payload as { text?: string } | undefined)?.text;
      if (!text) return { ok: false, error: 'text required' };
      const access = await currentAccess();
      if (access.status === 'no-tab' || access.status === 'restricted') {
        return { ok: false, access };
      }
      try {
        const injected = await chrome.scripting.executeScript({
          target: { tabId: access.tabId },
          func: insertDraftText,
          args: [text],
        });
        const result = injected[0]?.result as
          | { inserted: boolean; reason?: string }
          | undefined;
        if (!result?.inserted) {
          return {
            ok: false,
            error:
              result?.reason ??
              'no focused field — click into a text box on the page, then Insert again (or Copy)',
          };
        }
        return { ok: true };
      } catch {
        return { ok: false, access, needsAccess: true };
      }
    }

    case 'GET_GRANTED_ORIGINS':
      return { ok: true, origins: await listGrantedOrigins() };

    case 'REVOKE_ORIGIN': {
      // Revoke itself happens in the panel (gesture context); the worker only
      // reports the resulting list so both sides agree.
      return { ok: true, origins: await listGrantedOrigins() };
    }

    /**
     * Screenshot of the visible viewport (Phase D4).
     *
     * `captureVisibleTab` needs page access for the tab, so this reuses the same
     * gate as extraction — a screenshot is at least as sensitive as page text and
     * must not be reachable on a site the user has not allowed.
     */
    case 'CAPTURE_SCREENSHOT': {
      const access = await currentAccess();
      if (access.status !== 'ready') {
        return { ok: false, access };
      }
      try {
        const pngDataUrl = await chrome.tabs.captureVisibleTab({
          format: 'png',
        });
        const shot = await downscaleToJpeg(pngDataUrl);
        if (!shot) {
          return { ok: false, error: 'could not encode the screenshot' };
        }
        return { ok: true, access, screenshot: shot satisfies CapturedScreenshot };
      } catch (err) {
        return {
          ok: false,
          access,
          error:
            err instanceof Error
              ? err.message
              : 'Chrome would not capture this tab',
        };
      }
    }

    case 'TAKE_PENDING_SELECTION': {
      const selection = await takePendingSelection();
      return { ok: true, selection };
    }

    case 'CLEAR_PAGE_CACHE': {
      const tabId = (message.payload as { tabId?: number } | undefined)?.tabId;
      if (typeof tabId === 'number') await clearCachedExtract(tabId);
      else await clearAllCachedExtracts();
      return { ok: true };
    }

    default:
      return { ok: false, error: 'unhandled' };
  }
}

/**
 * Readability first (bundled unlisted script), inline heuristic second.
 * Returns null when we have no access to this tab at all.
 */
async function runExtract(tabId: number): Promise<PageExtract | null> {
  const viaReadability = await injectExtractorFile(tabId);
  if (viaReadability?.extractedText) return viaReadability;
  return injectHeuristic(tabId);
}

async function injectExtractorFile(
  tabId: number,
): Promise<PageExtract | null> {
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      files: [EXTRACTOR_FILE],
    });
    const result = injected[0]?.result;
    return (result as PageExtract | null | undefined) ?? null;
  } catch {
    return null;
  }
}

async function injectHeuristic(tabId: number): Promise<PageExtract | null> {
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractInPage,
      args: [MAX_EXTRACT_CHARS],
    });
    const result = injected[0]?.result;
    return (result as PageExtract | null | undefined) ?? null;
  } catch {
    return null;
  }
}

function insertDraftText(text: string): { inserted: boolean; reason?: string } {
  const el = document.activeElement as HTMLElement | null;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = `${el.value.slice(0, start)}${text}${el.value.slice(end)}`;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { inserted: true };
  }
  if (el?.isContentEditable) {
    const ok = document.execCommand('insertText', false, text);
    return ok
      ? { inserted: true }
      : { inserted: false, reason: 'could not insert into contenteditable' };
  }
  return {
    inserted: false,
    reason:
      'no focused field — click into a text box on the page, then Insert again',
  };
}

/** Fallback only — the shipped path is entrypoints/extractor.ts (Readability). */
function extractInPage(maxChars: number): {
  url: string;
  title: string;
  extractedText: string;
  contentHash: string;
} {
  const normalize = (t: string) => t.replace(/\s+/g, ' ').trim();
  const title = document.title || '';
  let extractedText = '';

  // Prefer semantic containers; then largest text block; then body.
  const candidates = Array.from(
    document.querySelectorAll('main, article, [role="main"]'),
  );
  let best = '';
  for (const node of candidates) {
    const t = normalize(node.textContent ?? '');
    if (t.length > best.length) best = t;
  }
  if (best.length >= 40) {
    extractedText = best;
  } else {
    extractedText = normalize(document.body?.innerText ?? '');
  }

  if (extractedText.length > maxChars) {
    extractedText = `${extractedText.slice(0, maxChars)}…`;
  }
  const url = location.href;
  const seed = `${url}\n${title}\n${extractedText}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return {
    url,
    title,
    extractedText,
    contentHash: `fnv:${hash.toString(16)}`,
  };
}
