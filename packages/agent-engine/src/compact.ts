/**
 * Extractive mid-run compaction: when history grows past a threshold, replace
 * the dropped middle with a deterministic summary message (no extra Bedrock call).
 * Preserves the first user framing turn and a recent toolUse/toolResult tail.
 */

import type { Message } from '@aws-sdk/client-bedrock-runtime';
import { cloneMessages, trimSessionMessages } from './session.js';

/** Compact when message count exceeds this. */
export const DEFAULT_COMPACT_THRESHOLD = 36;
/** Keep this many newest messages after compaction (pair-aligned via trim). */
export const DEFAULT_COMPACT_KEEP_RECENT = 16;

function roleOf(m: Message): string {
  return m.role ?? '';
}

function summarizeContentBlock(block: unknown): string | null {
  if (!block || typeof block !== 'object') return null;
  const b = block as Record<string, unknown>;
  if (typeof b.text === 'string') {
    const t = b.text.trim().replace(/\s+/g, ' ');
    return t ? t.slice(0, 160) : null;
  }
  if (b.toolUse && typeof b.toolUse === 'object') {
    const tu = b.toolUse as Record<string, unknown>;
    const name = String(tu.name ?? 'tool');
    return `toolUse:${name}`;
  }
  if (b.toolResult && typeof b.toolResult === 'object') {
    const tr = b.toolResult as Record<string, unknown>;
    const status = String(tr.status ?? 'unknown');
    const id = String(tr.toolUseId ?? '').slice(0, 8);
    return `toolResult:${status}${id ? `#${id}` : ''}`;
  }
  return null;
}

/** Build a compact text summary of dropped middle messages. */
export function summarizeDroppedMessages(dropped: Message[]): string {
  const lines: string[] = [
    '# Compacted earlier context',
    '',
    'Older tool rounds were summarized to save context. Recent messages below are verbatim.',
    '',
  ];
  let n = 0;
  for (const m of dropped) {
    const role = roleOf(m) || 'unknown';
    const bits: string[] = [];
    for (const block of m.content ?? []) {
      const s = summarizeContentBlock(block);
      if (s) bits.push(s);
      if (bits.length >= 4) break;
    }
    if (!bits.length) continue;
    n += 1;
    if (n > 40) {
      lines.push(`- … (${dropped.length - n + 1} more turns omitted)`);
      break;
    }
    lines.push(`- [${role}] ${bits.join(' · ')}`);
  }
  if (n === 0) {
    lines.push('- (no extractable tool activity)');
  }
  return lines.join('\n');
}

/**
 * If over threshold, keep first user message + summary of the middle + recent tail.
 * Always safe for Bedrock pairing (tail is pair-trimmed).
 */
export function compactSessionMessages(
  messages: Message[],
  opts?: { threshold?: number; keepRecent?: number },
): { messages: Message[]; compacted: boolean } {
  const threshold = opts?.threshold ?? DEFAULT_COMPACT_THRESHOLD;
  const keepRecent = opts?.keepRecent ?? DEFAULT_COMPACT_KEEP_RECENT;
  if (messages.length <= threshold) {
    return { messages, compacted: false };
  }

  const cloned = cloneMessages(messages);
  const first = cloned[0];
  const tailStart = Math.max(1, cloned.length - keepRecent);
  let start = tailStart;
  // Do not start tail on a lone toolResult user turn.
  while (
    start > 1 &&
    roleOf(cloned[start]!) === 'user' &&
    (cloned[start]!.content ?? []).some(
      (b) => b && typeof b === 'object' && 'toolResult' in b,
    )
  ) {
    start -= 1;
  }

  const dropped = cloned.slice(1, start);
  if (dropped.length === 0) {
    return { messages, compacted: false };
  }
  const tail = trimSessionMessages(cloned.slice(start), keepRecent);
  const summaryText = summarizeDroppedMessages(dropped);

  const out: Message[] = [];
  if (first && roleOf(first) === 'user') {
    out.push(first);
  }
  out.push({ role: 'user', content: [{ text: summaryText }] });
  // Avoid consecutive user if first was kept and summary is user — merge if needed.
  if (
    out.length >= 2 &&
    roleOf(out[0]!) === 'user' &&
    roleOf(out[1]!) === 'user' &&
    first
  ) {
    const a = out[0]!;
    const b = out[1]!;
    out.splice(0, 2, {
      role: 'user',
      content: [...(a.content ?? []), ...(b.content ?? [])],
    });
  }
  for (const m of tail) {
    // Skip duplicate if tail begins with same first message object content
    out.push(m);
  }
  // Final pair-safe trim
  return {
    messages: trimSessionMessages(out, threshold),
    compacted: true,
  };
}
