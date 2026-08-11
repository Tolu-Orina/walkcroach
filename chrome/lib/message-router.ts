import type { ExtensionMessage } from './messaging';
import { resolvePageAccess, type PageAccess } from './page-access';
import type { PageExtract } from './extract';
import type { PendingSelection } from './selection';
import type { CapturedScreenshot } from './screenshot';

/**
 * The side panel ↔ service worker message router (Phase G1).
 *
 * Extracted from `entrypoints/background.ts` because it is the security boundary
 * of the extension — every path by which page content, a screenshot, or a queued
 * selection can leave the page runs through this switch — and it was at 0%
 * coverage. Worse, it was not even *in* the coverage report: the worker is a WXT
 * entrypoint that calls `defineBackground` at module scope, so importing it in a
 * test pulls in the whole Chrome extension runtime.
 *
 * Dependencies are injected rather than imported, so the router can be driven
 * with fakes. `background.ts` is now the thin adapter that binds real `chrome.*`
 * calls to this interface.
 *
 * The rule the tests pin: **page access is checked before anything is read**, and
 * a screenshot is gated at least as strictly as page text.
 */
export type RouterDeps = {
  /** Classify the focused tab. Never reads page content. */
  getAccess: () => Promise<PageAccess>;
  /** Run the extractor in a tab. Resolves null when injection is impossible. */
  extract: (tabId: number) => Promise<PageExtract | null>;
  readCache: (tabId: number, url: string) => Promise<PageExtract | null>;
  writeCache: (tabId: number, extract: PageExtract) => Promise<void>;
  clearCache: (tabId?: number) => Promise<void>;
  listGrants: () => Promise<string[]>;
  insertDraft: (
    tabId: number,
    text: string,
  ) => Promise<{ inserted: boolean; reason?: string }>;
  takeSelection: () => Promise<PendingSelection | null>;
  /** Capture + downscale the visible viewport. */
  captureScreenshot: (tabId: number) => Promise<CapturedScreenshot | null>;
};

export type RouterResponse = Record<string, unknown>;

type DeadEndAccess = Extract<
  PageAccess,
  { status: 'no-tab' } | { status: 'restricted' }
>;

/**
 * Access states from which nothing can ever be read, whatever the user grants.
 *
 * A type predicate rather than a plain boolean so that narrowing survives the
 * call: after an early return on this, the remaining states are exactly the ones
 * that carry a `tabId`, and the compiler enforces that rather than a cast.
 */
function isDeadEnd(access: PageAccess): access is DeadEndAccess {
  return access.status === 'no-tab' || access.status === 'restricted';
}

export async function routeMessage(
  message: ExtensionMessage,
  deps: RouterDeps,
): Promise<RouterResponse> {
  switch (message.type) {
    case 'PING':
      return { ok: true, pong: true };

    case 'GET_PAGE_CONTEXT': {
      const access = await deps.getAccess();
      return { ok: true, access };
    }

    /**
     * "Check this tab again" (unknown-state retry).
     *
     * The button used to send GET_PAGE_CONTEXT, which only re-ran the
     * classifier — and the classifier returns `unknown` precisely because
     * `tab.url` is hidden without a host grant. A toolbar click does not
     * populate `tab.url`, so the answer could never change and the button
     * genuinely did nothing, while Summarize worked one control below because
     * it goes through the extract path where `activeTab` is live.
     *
     * So probe instead of re-asking. A successful extract proves readability
     * AND recovers the url and title that `tab.url` withheld, which is enough
     * to run the real classifier and offer the permanent grant the copy
     * promises. Failure leaves the original state untouched.
     */
    case 'RECHECK_PAGE_ACCESS': {
      const access = await deps.getAccess();
      if (access.status !== 'unknown') return { ok: true, access };

      const extract = await deps.extract(access.tabId);
      if (!extract) return { ok: true, access, probed: true };

      await deps.writeCache(access.tabId, extract);
      const grants = await deps.listGrants();
      const resolved = await resolvePageAccess(
        { id: access.tabId, url: extract.url, title: extract.title },
        async (pattern) => grants.includes(pattern),
      );
      return { ok: true, access: resolved, probed: true };
    }

    /**
     * Classify the focused tab for the panel — never extract page text.
     *
     * Runs on panel open. Reading the page here would contradict "only when you
     * click an action". Cache fills on GET_ACTIVE_EXTRACT / explicit actions.
     */
    case 'WARM_PAGE_CONTEXT': {
      const access = await deps.getAccess();
      return { ok: true, access, warmed: false };
    }

    case 'GET_ACTIVE_TAB_INFO': {
      const access = await deps.getAccess();
      // Order matters for narrowing: excluding `unknown` too leaves only the
      // states that carry a url and title.
      if (access.status === 'unknown' || isDeadEnd(access)) {
        return { ok: false, access };
      }
      return {
        ok: true,
        access,
        tabId: access.tabId,
        url: access.url,
        title: access.title,
      };
    }

    case 'GET_ACTIVE_EXTRACT': {
      const access = await deps.getAccess();
      if (access.status === 'ready') {
        const cached = await deps.readCache(access.tabId, access.url);
        if (cached) return { ok: true, access, extract: cached, cached: true };
      }
      if (isDeadEnd(access)) return { ok: false, access };
      // Durable grant required for known origins. Best-effort extract on
      // `needs-grant` contradicted "only when Allowed" and could cache text
      // before the user clicked Allow. Panel `preparePage` requests the grant
      // first; the worker must refuse if that grant is still missing.
      // `unknown` may still attempt once: a live toolbar `activeTab` window can
      // reveal the URL without a prior optional-host grant.
      if (access.status === 'needs-grant') return { ok: false, access };
      const extract = await deps.extract(access.tabId);
      if (!extract) return { ok: false, access };
      await deps.writeCache(access.tabId, extract);
      return { ok: true, access, extract, cached: false };
    }

    case 'INSERT_DRAFT': {
      const text = (message.payload as { text?: string } | undefined)?.text;
      if (!text) return { ok: false, error: 'Nothing to insert.' };
      const access = await deps.getAccess();
      if (isDeadEnd(access)) return { ok: false, access };
      try {
        const result = await deps.insertDraft(access.tabId, text);
        if (!result.inserted) {
          return {
            ok: false,
            error:
              result.reason ??
              'No focused field — click into a text box on the page, then Insert again (or Copy response)',
          };
        }
        return { ok: true };
      } catch {
        return { ok: false, access, needsAccess: true };
      }
    }

    case 'GET_GRANTED_ORIGINS':
      return { ok: true, origins: await deps.listGrants() };

    case 'REVOKE_ORIGIN':
      // Revoke itself happens in the panel (gesture context); the worker only
      // reports the resulting list so both sides agree.
      return { ok: true, origins: await deps.listGrants() };

    /**
     * Screenshot of the visible viewport.
     *
     * Gated on `ready` and nothing weaker: unlike extraction, this does not fall
     * through to a best-effort attempt on `needs-grant` or `unknown`. An image of
     * the screen is more revealing than page text — it includes whatever else is
     * on screen — so it is only ever taken on a site the user has allowed.
     */
    case 'CAPTURE_SCREENSHOT': {
      const access = await deps.getAccess();
      if (access.status !== 'ready') return { ok: false, access };
      try {
        const screenshot = await deps.captureScreenshot(access.tabId);
        if (!screenshot) {
          return {
            ok: false,
            access,
            error: 'Couldn’t capture the screenshot. Try again.',
          };
        }
        return { ok: true, access, screenshot };
      } catch (err) {
        return {
          ok: false,
          access,
          error:
            err instanceof Error
              ? err.message
              : 'Chrome would not capture this tab',
        };
      }
    }

    case 'TAKE_PENDING_SELECTION':
      return { ok: true, selection: await deps.takeSelection() };

    case 'CLEAR_PAGE_CACHE': {
      const tabId = (message.payload as { tabId?: number } | undefined)?.tabId;
      await deps.clearCache(typeof tabId === 'number' ? tabId : undefined);
      return { ok: true };
    }

    default:
      return { ok: false, error: 'Something went wrong. Try again.' };
  }
}
