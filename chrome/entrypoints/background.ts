import {
  isAllowedMessage,
  isTrustedSender,
  type ExtensionMessage,
} from '../lib/messaging';
import type { PageExtract } from '../lib/extract';
import { MAX_EXTRACT_CHARS } from '../lib/extract';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  });

  chrome.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
      if (!isTrustedSender(sender) || !isAllowedMessage(message)) {
        sendResponse({ ok: false, error: 'rejected' });
        return false;
      }

      // sidePanel.open must stay in the same user-gesture turn as the FAB click.
      if (
        typeof message === 'object' &&
        message &&
        (message as ExtensionMessage).type === 'FAB_CLICK'
      ) {
        const tabId = sender.tab?.id;
        if (tabId != null) {
          void chrome.sidePanel.open({ tabId });
        }
        sendResponse({ ok: true, tabId: tabId ?? null });
        return false;
      }

      void handleMessage(message as ExtensionMessage, sender).then(sendResponse);
      return true;
    },
  );
});

async function handleMessage(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
): Promise<Record<string, unknown>> {
  switch (message.type) {
    case 'PING':
      return { ok: true, pong: true };
    case 'DRAFT_FIELD_FOCUS': {
      await chrome.storage.session.set({ wc_draft_intent: true });
      return { ok: true };
    }
    case 'GET_ACTIVE_TAB_INFO': {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id || !tab.url) {
        return { ok: false, error: 'no active tab' };
      }
      return {
        ok: true,
        tabId: tab.id,
        url: tab.url,
        title: tab.title ?? '',
      };
    }
    case 'GET_ACTIVE_EXTRACT': {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) return { ok: false, error: 'no active tab' };
      const extract = await requestExtract(tab.id);
      return { ok: true, extract };
    }
    case 'GET_GRANTED_ORIGINS': {
      const perms = await chrome.permissions.getAll();
      return { ok: true, origins: perms.origins ?? [] };
    }
    case 'REVOKE_ORIGIN': {
      const origin = (message.payload as { origin?: string } | undefined)
        ?.origin;
      if (!origin) return { ok: false, error: 'origin required' };
      const removed = await chrome.permissions.remove({ origins: [origin] });
      return { ok: true, removed };
    }
    default:
      return { ok: false, error: 'unhandled' };
  }
}

async function requestExtract(tabId: number): Promise<PageExtract | null> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, {
      type: 'EXTRACT_PAGE',
    })) as { ok?: boolean; payload?: PageExtract };
    if (res?.ok && res.payload) return res.payload;
  } catch {
    // content script may not be injected yet
  }

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

/** Injected into the page — no extension imports available here. */
function extractInPage(maxChars: number): {
  url: string;
  title: string;
  extractedText: string;
  contentHash: string;
} {
  const normalize = (t: string) => t.replace(/\s+/g, ' ').trim();
  let title = document.title || '';
  let extractedText = '';
  const main =
    document.querySelector('main, article, [role="main"]')?.textContent ??
    document.body?.innerText ??
    '';
  extractedText = normalize(main);
  if (extractedText.length > maxChars) {
    extractedText = `${extractedText.slice(0, maxChars)}…`;
  }
  const url = location.href;
  // Always use the same FNV fallback as extract.ts when subtle is unavailable,
  // and SHA-256 when available — keeps contentHash stable across inject paths.
  const seed = `${url}\n${title}\n${extractedText}`;
  // Synchronous inject path: FNV only (matches extract.ts fallbackHash).
  // Subtle digest is async and cannot be awaited here reliably from executeScript.
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
