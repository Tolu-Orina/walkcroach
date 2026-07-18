import { isAllowedMessage, isTrustedSender } from '../lib/messaging';
import { extractPage } from '../lib/extract';

const FAB_HOST_ID = 'walkcroach-fab-host';
const HINT_HOST_ID = 'walkcroach-hint-host';
const DISMISS_KEY = 'wc_fab_dismissed';

function isTopFrame(): boolean {
  try {
    return window === window.top;
  } catch {
    return false;
  }
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  allFrames: true,
  main() {
    void chrome.storage.session.get(DISMISS_KEY).then((data) => {
      // FAB only on top frame to avoid duplicates in iframes
      if (!data[DISMISS_KEY] && isTopFrame()) mountFab();
    });

    // Editable-field hints only on the top frame (avoid iframe spam / broken UX)
    if (isTopFrame()) watchEditableFields();

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!isTrustedSender(sender) || !isAllowedMessage(message)) {
        return false;
      }
      if (message.type === 'EXTRACT_PAGE') {
        // Prefer top-frame extract; skip nested frames
        if (!isTopFrame()) {
          sendResponse({ ok: false, error: 'not top frame' });
          return false;
        }
        void extractPage().then((payload) => {
          sendResponse({
            ok: true,
            type: 'PAGE_EXTRACT_RESULT',
            payload,
          });
        });
        return true;
      }
      if (message.type === 'FAB_DISMISS') {
        document.getElementById(FAB_HOST_ID)?.remove();
        document.getElementById(HINT_HOST_ID)?.remove();
        void chrome.storage.session.set({ [DISMISS_KEY]: true });
        sendResponse({ ok: true });
        return true;
      }
      if (message.type === 'INSERT_DRAFT') {
        const text = (message.payload as { text?: string } | undefined)?.text;
        if (text) insertAtFocused(text);
        sendResponse({ ok: true });
        return true;
      }
      return false;
    });
  },
});

function mountFab(): void {
  if (document.getElementById(FAB_HOST_ID)) return;

  const host = document.createElement('div');
  host.id = FAB_HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    .wrap { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
    .wc-fab {
      width: 48px; height: 48px; border-radius: 14px; border: none; cursor: pointer;
      background: #1a3a2a; color: #e8f5ee; font: 600 13px/1 system-ui, sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    }
    .wc-fab:hover { background: #244d38; }
    .dismiss {
      background: transparent; border: none; color: #5a6b62; font: 11px system-ui; cursor: pointer;
    }
    .wc-tip {
      background: #122018; color: #e8f5ee; font: 13px/1.35 system-ui, sans-serif;
      padding: 8px 12px; border-radius: 8px; max-width: 220px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    }
  `;

  const wrap = document.createElement('div');
  wrap.className = 'wrap';

  const btn = document.createElement('button');
  btn.className = 'wc-fab';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Open WalkCroach');
  btn.textContent = 'WC';
  btn.addEventListener('click', () => {
    tip?.remove();
    void chrome.runtime.sendMessage({ type: 'FAB_CLICK' });
  });

  const dismiss = document.createElement('button');
  dismiss.className = 'dismiss';
  dismiss.type = 'button';
  dismiss.textContent = 'Hide for now';
  dismiss.addEventListener('click', () => {
    host.remove();
    void chrome.storage.session.set({ [DISMISS_KEY]: true });
  });

  wrap.append(btn, dismiss);
  shadow.append(style, wrap);
  document.documentElement.append(host);

  let tip: HTMLDivElement | null = null;
  void chrome.storage.session.get('wc_tip_shown').then((data) => {
    if (data.wc_tip_shown) return;
    tip = document.createElement('div');
    tip.className = 'wc-tip';
    tip.textContent = 'Click for a quick summary of this page';
    wrap.prepend(tip);
    void chrome.storage.session.set({ wc_tip_shown: true });
    setTimeout(() => tip?.remove(), 6000);
  });
}

function ensureHintShadow(): ShadowRoot {
  let host = document.getElementById(HINT_HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HINT_HOST_ID;
    document.documentElement.append(host);
  }
  return host.shadowRoot ?? host.attachShadow({ mode: 'open' });
}

function watchEditableFields(): void {
  let hint: HTMLButtonElement | null = null;
  let lastEditable: HTMLElement | null = null;

  const clear = () => {
    hint?.remove();
    hint = null;
  };

  document.addEventListener(
    'focusin',
    (ev) => {
      const el = ev.target as HTMLElement | null;
      if (!el || !isEditable(el)) {
        clear();
        return;
      }
      lastEditable = el;
      clear();
      const shadow = ensureHintShadow();
      if (!shadow.querySelector('style')) {
        const style = document.createElement('style');
        style.textContent = `
          .draft-hint {
            position: fixed; z-index: 2147483645; font: 12px system-ui; padding: 4px 8px;
            background: #1a3a2a; color: #e8f5ee; border-radius: 6px; cursor: pointer; border: none;
          }
        `;
        shadow.append(style);
      }
      hint = document.createElement('button');
      hint.type = 'button';
      hint.className = 'draft-hint';
      hint.textContent = 'Draft with WalkCroach';
      const rect = el.getBoundingClientRect();
      hint.style.left = `${Math.max(8, rect.left)}px`;
      hint.style.top = `${Math.max(8, rect.top - 28)}px`;
      hint.addEventListener('mousedown', (e) => {
        e.preventDefault();
        void chrome.runtime.sendMessage({
          type: 'DRAFT_FIELD_FOCUS',
          payload: { url: location.href },
        });
        void chrome.runtime.sendMessage({ type: 'FAB_CLICK' });
      });
      shadow.append(hint);
    },
    true,
  );

  document.addEventListener('focusout', () => {
    setTimeout(clear, 200);
  });

  // Expose last editable for insert after side-panel focus steal
  (window as unknown as { __wcLastEditable?: HTMLElement | null }).__wcLastEditable =
    null;
  document.addEventListener(
    'focusin',
    () => {
      (window as unknown as { __wcLastEditable?: HTMLElement | null }).__wcLastEditable =
        lastEditable;
    },
    true,
  );
}

function isEditable(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) {
    const t = el.type;
    return (
      !el.disabled &&
      !el.readOnly &&
      (t === 'text' || t === 'email' || t === 'search' || t === '')
    );
  }
  return el.isContentEditable;
}

function insertAtFocused(text: string): void {
  const remembered = (
    window as unknown as { __wcLastEditable?: HTMLElement | null }
  ).__wcLastEditable;
  const el =
    (document.activeElement as HTMLElement | null) &&
    isEditable(document.activeElement as HTMLElement)
      ? (document.activeElement as HTMLElement)
      : remembered;
  if (!el) return;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = `${el.value.slice(0, start)}${text}${el.value.slice(end)}`;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (el.isContentEditable) {
    el.focus();
    document.execCommand('insertText', false, text);
  }
}
