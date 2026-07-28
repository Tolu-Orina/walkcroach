import type { ContentBlock, Message } from '@aws-sdk/client-bedrock-runtime';

/** Soft cap on persisted session messages (tool-heavy turns are large). */
export const DEFAULT_MAX_SESSION_MESSAGES = 48;

function roleOf(m: Message): string {
  return m.role ?? '';
}

function isNonEmptyContentBlock(block: unknown): boolean {
  if (!block || typeof block !== 'object') return false;
  const b = block as Record<string, unknown>;
  if ('text' in b) return true;
  if ('toolUse' in b) return true;
  if ('toolResult' in b) return true;
  if ('image' in b) return true;
  if ('document' in b) return true;
  if ('cachePoint' in b) return true;
  return Object.keys(b).length > 0;
}

/**
 * Bedrock Converse requires every Message.content to be a non-empty array of
 * ContentBlock. Empty arrays (e.g. reasoning-only assistant turns, corrupt
 * jsonl) fail Continue with:
 * "The content field in the Message object at messages.N is empty".
 */
export function sanitizeConverseMessages(messages: Message[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    const role = roleOf(m);
    if (role !== 'user' && role !== 'assistant') continue;
    const raw = Array.isArray(m.content) ? m.content : [];
    const content = raw.filter(isNonEmptyContentBlock) as ContentBlock[];
    if (content.length === 0) {
      // Keep turn order / tool pairing; never send [].
      out.push({
        role: role as 'user' | 'assistant',
        content: [{ text: '(empty turn — recovered)' }],
      });
      continue;
    }
    out.push({ role: role as 'user' | 'assistant', content });
  }
  return out;
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
  const sanitized = sanitizeConverseMessages(messages);
  if (sanitized.length <= max) return sanitized;

  let start = sanitized.length - max;
  // If we would start on a tool-result user turn, include the prior assistant.
  while (start > 0 && isToolResultUserTurn(sanitized[start]!)) {
    start -= 1;
  }
  // If first kept message is assistant without its preceding user, nudge back.
  while (
    start > 0 &&
    roleOf(sanitized[start]!) === 'assistant' &&
    roleOf(sanitized[start - 1]!) === 'user'
  ) {
    // Prefer keeping the pair; may exceed max by 1 — acceptable.
    if (sanitized.length - (start - 1) <= max + 2) {
      start -= 1;
    }
    break;
  }

  const tail = sanitized.slice(start);
  const first = sanitized[0];
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
 * Append a follow-up user text turn (optionally with attachment content
 * blocks) without creating two consecutive `user` roles (illegal for Bedrock
 * Converse after a tool-result user turn).
 */
export function appendUserFollowUp(
  prior: Message[],
  text: string,
  extraBlocks: ContentBlock[] = [],
): Message[] {
  const messages = sanitizeConverseMessages(cloneMessages(prior));
  const newBlocks: ContentBlock[] = [{ text }, ...extraBlocks];
  const last = messages[messages.length - 1];
  if (last && roleOf(last) === 'user') {
    const content = [...(last.content ?? []), ...newBlocks];
    messages[messages.length - 1] = { role: 'user', content };
    return messages;
  }
  messages.push({ role: 'user', content: newBlocks });
  return messages;
}
