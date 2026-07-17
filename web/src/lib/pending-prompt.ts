import { DEFAULT_TEMPLATE_ID } from '../templates';

export const PENDING_PROMPT_KEY = 'walkcroach.pending-prompt.v1';

export type PendingPrompt = {
  prompt: string;
  templateId: string;
};

export function inferTemplateFromPrompt(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (/\b(waitlist|landing page|email capture|launch page)\b/.test(lower)) {
    return 'landing-waitlist';
  }
  if (/\b(saas|trial|marketing site|product page)\b/.test(lower)) {
    return 'saas-marketing';
  }
  if (/\b(portfolio|case study|personal site)\b/.test(lower)) {
    return 'portfolio';
  }
  if (/\b(dashboard|metrics|ops|analytics)\b/.test(lower)) {
    return 'internal-dashboard';
  }
  if (/\b(todo|task list|checklist)\b/.test(lower)) {
    return 'todo';
  }
  if (/\b(blog|article|post list)\b/.test(lower)) {
    return 'blog';
  }
  if (/\b(pricing|faq)\b/.test(lower)) {
    return 'pricing-faq';
  }
  if (/\b(crud|admin table|accounts)\b/.test(lower)) {
    return 'admin-crud';
  }
  return DEFAULT_TEMPLATE_ID;
}

export function projectNameFromPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.length <= 48) return trimmed;
  return `${trimmed.slice(0, 45)}…`;
}

export function setPendingPrompt(prompt: string, templateId?: string): void {
  const trimmed = prompt.trim();
  if (!trimmed) return;
  const payload: PendingPrompt = {
    prompt: trimmed,
    templateId: templateId ?? inferTemplateFromPrompt(trimmed),
  };
  sessionStorage.setItem(PENDING_PROMPT_KEY, JSON.stringify(payload));
}

export function peekPendingPrompt(): PendingPrompt | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PROMPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingPrompt;
    if (!parsed.prompt?.trim()) return null;
    return {
      prompt: parsed.prompt.trim(),
      templateId: parsed.templateId || DEFAULT_TEMPLATE_ID,
    };
  } catch {
    return null;
  }
}

export function consumePendingPrompt(): PendingPrompt | null {
  const pending = peekPendingPrompt();
  if (pending) sessionStorage.removeItem(PENDING_PROMPT_KEY);
  return pending;
}
