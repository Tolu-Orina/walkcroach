/**
 * Injected page extractor (Phase B5).
 *
 * An *unlisted* script: WXT bundles it (so it can `import` Mozilla Readability)
 * but never declares it under `content_scripts`, keeping the manifest free of
 * always-on page injection. The service worker runs it on demand with
 * `chrome.scripting.executeScript({ files: ['extractor.js'] })`, and WXT returns
 * `main()`'s value through the executeScript result.
 *
 * This is why `lib/extract.ts` (Readability) is finally the shipped path instead
 * of the cruder inline heuristic in `background.ts`, which now only survives as a
 * fallback for pages where this bundle fails to run.
 */
import { extractPage } from '../lib/extract';

export default defineUnlistedScript(async () => {
  try {
    return await extractPage(document);
  } catch {
    return null;
  }
});
