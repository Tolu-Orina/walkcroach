import type { Message } from '@aws-sdk/client-bedrock-runtime';

/** Soft cap on persisted session messages (tool-heavy turns are large). */
export const DEFAULT_MAX_SESSION_MESSAGES = 48;

function roleOf(m: Message): string {
  return m.role ?? '';
}

/**
 * True if this user message is a tool-result turn (must stay paired with the
 * preceding assistant toolUse message).
 */
function isToolResultUserTurn(m: Message): boolean {
  if (roleOf(m) !== 'user' || !m.content?.length) return false;
  return m.content.some(
    (b) => b && typeof b === 'object' && 'toolResult' in b,
  );
}

/**
 * Keep the most recent turns so Continue / follow-ups retain tool context.
 * Never splits an assistant toolUse from its following toolResult user turn.
 * Always preserves the first user message when possible (task framing).
 */
export function trimSessionMessages(
  messages: Message[],
  max = DEFAULT_MAX_SESSION_MESSAGES,
): Message[] {
  if (messages.length <= max) return messages;

  let start = messages.length - max;
  // If we would start on a tool-result user turn, include the prior assistant.
  while (start > 0 && isToolResultUserTurn(messages[start]!)) {
    start -= 1;
  }
  // If first kept message is assistant without its preceding user, nudge back.
  while (
    start > 0 &&
    roleOf(messages[start]!) === 'assistant' &&
    roleOf(messages[start - 1]!) === 'user'
  ) {
    // Prefer keeping the pair; may exceed max by 1 — acceptable.
    if (messages.length - (start - 1) <= max + 2) {
      start -= 1;
    }
    break;
  }

  const tail = messages.slice(start);
  const first = messages[0];
  if (first && tail[0] !== first && roleOf(first) === 'user') {
    // Avoid consecutive user if first + tail[0] are both user.
    if (roleOf(tail[0]!) === 'user') {
      return [first, ...tail.slice(1)];
    }
    return [first, ...tail];
  }
  return tail;
}

export function cloneMessages(messages: Message[]): Message[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content ? [...m.content] : undefined,
  }));
}

/**
 * Append a follow-up user text turn without creating two consecutive `user`
 * roles (illegal for Bedrock Converse after a tool-result user turn).
 */
export function appendUserFollowUp(
  prior: Message[],
  text: string,
): Message[] {
  const messages = cloneMessages(prior);
  const last = messages[messages.length - 1];
  if (last && roleOf(last) === 'user') {
    const content = [...(last.content ?? []), { text }];
    messages[messages.length - 1] = { role: 'user', content };
    return messages;
  }
  messages.push({ role: 'user', content: [{ text }] });
  return messages;
}
