/**
 * Selection capture (Phase D3 — PRD FR-C05).
 *
 * A right-click on highlighted text hands the selection to the panel without
 * reading the rest of the page. Two reasons this is worth its own path rather
 * than folding into the full-page extract:
 *
 *  - Intent. "Save this paragraph" is a different act from "save this page", and
 *    the confirm card should show the user the words they highlighted.
 *  - Data minimisation. Only the selected text leaves the page, which is the
 *    strongest version of the privacy claim in the store listing.
 *
 * A context-menu click is one of Chrome's four `activeTab`-qualifying gestures,
 * so the worker can read the full selection via scripting. `info.selectionText`
 * is the fallback: Chrome truncates it around 1k characters, which is why it is
 * not the primary source.
 */

const PENDING_KEY = 'wc_pending_selection';

/** Long selections are capped well below the page-extract limit. */
export const MAX_SELECTION_CHARS = 8_000;

export type PendingSelection = {
  text: string;
  url: string;
  title: string;
  /** True when we fell back to Chrome's truncated `info.selectionText`. */
  truncated: boolean;
  capturedAt: number;
};

export function normalizeSelection(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    // Newline is itself a control character (0x0A), but paragraph structure is
    // meaning in a quote — blanking it would flatten a multi-paragraph
    // selection into one run-on line. Everything else non-printing becomes a
    // space and is collapsed below.
    if (code === 0x0a) {
      out += '\n';
      continue;
    }
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : ch;
  }
  const collapsed = out
    .replace(/[ \t]+/g, ' ')
    // Drop the spaces that a stripped CR or indentation leaves at line edges,
    // so the blank-line collapse below sees genuinely empty lines.
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return collapsed.length > MAX_SELECTION_CHARS
    ? `${collapsed.slice(0, MAX_SELECTION_CHARS).trimEnd()}…`
    : collapsed;
}

/** Enough text to be worth saving; a stray double-click is not a capture. */
export function isUsableSelection(text: string): boolean {
  return normalizeSelection(text).length >= 8;
}

export async function putPendingSelection(
  selection: PendingSelection,
): Promise<void> {
  await chrome.storage.session.set({ [PENDING_KEY]: selection });
}

/**
 * Read and clear in one step. The panel may already be open when the menu is
 * used, so this is a queue of exactly one — leaving it behind would re-offer the
 * same confirm card on the next panel open.
 */
export async function takePendingSelection(): Promise<PendingSelection | null> {
  const raw = await chrome.storage.session.get(PENDING_KEY);
  const pending = raw[PENDING_KEY] as PendingSelection | undefined;
  if (!pending?.text) return null;
  await chrome.storage.session.remove(PENDING_KEY);
  return pending;
}
