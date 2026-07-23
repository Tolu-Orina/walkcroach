/**
 * Page extract + draft insert via activeTab + scripting.executeScript.
 * No broad host permissions / content_scripts (CWS review path B).
 */
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

      void handleMessage(message as ExtensionMessage).then(sendResponse);
      return true;
    },
  );
});

async function handleMessage(
  message: ExtensionMessage,
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
        return {
          ok: false,
          error:
            'no active tab — click the WalkCroach toolbar icon on the page first',
        };
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
      if (!tab?.id) {
        return {
          ok: false,
          error:
            'no active tab — click the WalkCroach toolbar icon on the page first',
        };
      }
      const extract = await requestExtract(tab.id);
      if (!extract) {
        return {
          ok: false,
          error:
            'could not read this page — open WalkCroach from the toolbar on an http(s) page, then try again',
        };
      }
      return { ok: true, extract };
    }
    case 'INSERT_DRAFT': {
      const text = (message.payload as { text?: string } | undefined)?.text;
      if (!text) return { ok: false, error: 'text required' };
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) return { ok: false, error: 'no active tab' };
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: insertDraftText,
          args: [text],
        });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : 'insert failed — click the toolbar icon on the page first',
        };
      }
    }
    case 'GET_GRANTED_ORIGINS':
      // No host permissions in activeTab-only build.
      return { ok: true, origins: [] };
    case 'REVOKE_ORIGIN':
      return { ok: true, removed: false };
    default:
      return { ok: false, error: 'unhandled' };
  }
}

async function requestExtract(tabId: number): Promise<PageExtract | null> {
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

function insertDraftText(text: string): void {
  const el = document.activeElement as HTMLElement | null;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = `${el.value.slice(0, start)}${text}${el.value.slice(end)}`;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (el?.isContentEditable) {
    document.execCommand('insertText', false, text);
  }
}

function extractInPage(maxChars: number): {
  url: string;
  title: string;
  extractedText: string;
  contentHash: string;
} {
  const normalize = (t: string) => t.replace(/\s+/g, ' ').trim();
  const title = document.title || '';
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
