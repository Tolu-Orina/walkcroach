/**
 * Closed allowlist for extension messaging (Spyder/MaXSS mitigation).
 */

export const MESSAGE_TYPES = [
  /** Classify the focused tab. Never returns page content. */
  'GET_PAGE_CONTEXT',
  /**
   * Re-classify after the user clicked the toolbar icon, by probing the tab.
   *
   * Separate from GET_PAGE_CONTEXT because the probe *reads the page*, and
   * GET_PAGE_CONTEXT runs on panel open and on every tab change. Probing there
   * would break the promise the panel makes in its own words — "WalkCroach
   * reads a page only when you click an action". This message exists only
   * behind an explicit button press, which is that action.
   */
  'RECHECK_PAGE_ACCESS',
  /** Best-effort: extract + cache if we already have access. Never prompts. */
  'WARM_PAGE_CONTEXT',
  /** Extract the focused tab (cache-first). Requires an explicit user action. */
  'GET_ACTIVE_EXTRACT',
  'GET_ACTIVE_TAB_INFO',
  'INSERT_DRAFT',
  'GET_GRANTED_ORIGINS',
  'REVOKE_ORIGIN',
  'CLEAR_PAGE_CACHE',
  /** Read + clear a selection captured from the context menu (Phase D3). */
  'TAKE_PENDING_SELECTION',
  /** Capture + downscale the visible tab (Phase D4). Requires page access. */
  'CAPTURE_SCREENSHOT',
  'PING',
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

export type ExtensionMessage = {
  type: MessageType;
  payload?: unknown;
};

export function isAllowedMessage(msg: unknown): msg is ExtensionMessage {
  if (!msg || typeof msg !== 'object') return false;
  const type = (msg as { type?: unknown }).type;
  return (
    typeof type === 'string' &&
    (MESSAGE_TYPES as readonly string[]).includes(type)
  );
}

export function isTrustedSender(
  sender: chrome.runtime.MessageSender,
): boolean {
  return sender.id === chrome.runtime.id;
}
