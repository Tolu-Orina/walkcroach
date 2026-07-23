/**
 * Closed allowlist for extension messaging (Spyder/MaXSS mitigation).
 */

export const MESSAGE_TYPES = [
  'GET_ACTIVE_TAB_INFO',
  'GET_ACTIVE_EXTRACT',
  'INSERT_DRAFT',
  'DRAFT_FIELD_FOCUS',
  'GET_GRANTED_ORIGINS',
  'REVOKE_ORIGIN',
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
