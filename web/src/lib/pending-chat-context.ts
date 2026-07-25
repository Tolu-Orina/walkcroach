/**
 * Chrome → Web Chat deep-link context (one-time handoff from extension).
 */
export const PENDING_CHAT_CONTEXT_KEY = 'walkcroach.pending-chat-context.v1';

export type PendingChatContext = {
  title?: string | null;
  url?: string | null;
  extractedText: string;
  question?: string | null;
};

export function formatChatHandoffDraft(ctx: PendingChatContext): string {
  const parts = [
    ctx.title ? `Regarding: ${ctx.title}` : null,
    ctx.url ? `URL: ${ctx.url}` : null,
    '',
    ctx.extractedText.trim(),
    ctx.question?.trim() ? `\nQuestion: ${ctx.question.trim()}` : null,
  ].filter((p) => p !== null && p !== undefined) as string[];
  return parts.join('\n').trim();
}

export function setPendingChatContext(ctx: PendingChatContext): void {
  if (!ctx.extractedText?.trim()) return;
  sessionStorage.setItem(PENDING_CHAT_CONTEXT_KEY, JSON.stringify(ctx));
}

export function consumePendingChatContext(): PendingChatContext | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CHAT_CONTEXT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_CHAT_CONTEXT_KEY);
    const parsed = JSON.parse(raw) as PendingChatContext;
    if (!parsed.extractedText?.trim()) return null;
    return parsed;
  } catch {
    sessionStorage.removeItem(PENDING_CHAT_CONTEXT_KEY);
    return null;
  }
}
