/**
 * Tier B — detect CLI confirmation prompts from streamed output tails.
 */

export const MAX_CONFIRM_PROMPTS = 3;
/** Quiet period before treating trailing output as a blocking prompt. */
export const CONFIRM_IDLE_MS = 600;
/** Only inspect this many trailing characters for patterns. */
export const CONFIRM_TAIL_CHARS = 1_200;

/** Secrets / privileged prompts — never auto-answer; abort the command. */
export const PASSWORD_PROMPT_RE =
  /\b(password|passphrase|passcode)\b\s*[:=?]|\bsudo\b.*password|PIN\s*:/i;

/**
 * Common confirm / proceed shapes. Matched against the recent output tail.
 * Order: more specific first.
 */
export const CONFIRM_PROMPT_PATTERNS: Array<{
  re: RegExp;
  options: string[];
}> = [
  { re: /\[Y\/n\]/g, options: ['Y', 'n'] },
  { re: /\[y\/N\]/g, options: ['y', 'N'] },
  { re: /\[yes\/[Nn][Oo]\]/gi, options: ['yes', 'no'] },
  { re: /\[y\/n\]/gi, options: ['y', 'n'] },
  { re: /\(Y\/n\)/g, options: ['Y', 'n'] },
  { re: /\(y\/N\)/g, options: ['y', 'N'] },
  { re: /\(yes\/no\)/gi, options: ['yes', 'no'] },
  { re: /\(y\/n\)/gi, options: ['y', 'n'] },
  {
    re: /\b(do you want to continue|are you sure|proceed\?|continue\?)\b/gi,
    options: ['y', 'n'],
  },
  {
    re: /press enter (to continue|to confirm)/gi,
    options: ['(Enter)', 'abort'],
  },
];

export type DetectedConfirmPrompt = {
  matched: string;
  options: string[];
  /** Slice of output shown to the user. */
  promptText: string;
};

export function looksLikePasswordPrompt(tail: string): boolean {
  return PASSWORD_PROMPT_RE.test(tail);
}

/**
 * Find the last confirm-style prompt in `output`. Returns null if none.
 */
export function detectConfirmPrompt(
  output: string,
): DetectedConfirmPrompt | null {
  const tail = output.slice(-CONFIRM_TAIL_CHARS);
  if (!tail.trim()) return null;
  if (looksLikePasswordPrompt(tail)) return null;

  let best: DetectedConfirmPrompt | null = null;
  let bestIndex = -1;

  for (const { re, options } of CONFIRM_PROMPT_PATTERNS) {
    // Fresh regex each time (global lastIndex).
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
    const local = new RegExp(re.source, flags);
    let m: RegExpExecArray | null;
    while ((m = local.exec(tail)) !== null) {
      // Prefer earlier (more specific) patterns on equal index.
      if (m.index > bestIndex) {
        bestIndex = m.index;
        best = {
          matched: m[0],
          options: [...options],
          promptText: tail.slice(Math.max(0, m.index - 80)).trim(),
        };
      }
    }
  }
  return best;
}

export type ConfirmPromptAnswer = string | 'abort';

export type ConfirmPromptRequest = {
  matched: string;
  options: string[];
  promptText: string;
  promptIndex: number;
  maxPrompts: number;
};
