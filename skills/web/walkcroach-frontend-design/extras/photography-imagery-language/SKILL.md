---
name: photography-imagery-language
description: Governs when and how to use real photography, 3D renders, or illustration in a UI or landing page — sourcing via download, generation, or hyperlink, consistent treatment across cards and sections, licensing discipline, avoiding stock-photo cliché, and loading behavior. Use this skill whenever a build needs hero imagery, product/hardware photography, human/lifestyle photography, or feature/content cards, or any decision about photography vs. illustration vs. icon-only. Pair with design-token-discipline (color treatment) and state-coverage-edge-cases (image loading states).
---

# Photography & Imagery Language

Icons and typography can carry information and hierarchy, but they can't carry warmth, scale, or trust the way imagery can. A hardware photo says "this runs on real equipment"; a human photo says "real people use this" — an icon can't do either. This skill governs how to add imagery without it looking like generic stock-photo filler.

## Source images three ways

Images may be obtained by any of these methods — pick deliberately per asset, not by habit:

1. **Downloaded** — fetch a licensed asset into the project (local `public/` / `assets/` file, or object storage). Prefer when you need offline reliability, stable URLs, and full control over crop/optimization.
2. **Generated** — create the image with an image model / design tool (e.g. Nova Canvas, Midjourney, product renders). Prefer when you need brand-perfect color, fictional/abstract subjects, or no suitable licensed photo exists. Still apply one consistent treatment across the page.
3. **Hyperlinked** — reference a remote URL (`src` / CSS `url()` / CDN / stock CDN). Prefer when the host is intentional and stable (your CDN, a licensed stock CDN, a confirmed partner URL). Document the source; do not rely on random third-party hotlinks that can break or revoke access.

Mixing sources on one page is fine if the **visual treatment** stays consistent (grade, crop, overlay). State which method you used for each hero/card image when handing work off.

## Choose the medium deliberately

- **Real photography** — use when the goal is trust, authenticity, or showing something physical (hardware, a real environment, real people). Best for products with a tangible, real-world component (retail hardware, physical spaces, in-person service).
- **3D render / illustration** — use when full control over brand color is more valuable than realism, or when the product is abstract (pure software, data, infrastructure) with nothing physical to photograph. Easier to keep perfectly on-palette than photography.
- **Icon-only** — sufficient for dense, functional UI (dashboards, tables, settings) where imagery would only add visual noise. Don't force a photo into a screen that doesn't need one.

Don't mix mediums on one page without reason — a photographic hero next to a flat illustration mid-page reads as inconsistent, the same way mixing icon libraries does.

## Cards benefit from photography more than icons alone

An icon-only feature/content card makes a claim; a card with a real photograph behind or alongside it shows evidence. Default to putting a photo in a card whenever the card is describing something that actually exists in the physical or operational world (a security mechanism, a piece of hardware, an environment, an architecture concept with a real-world analog) — icon-only is the fallback for genuinely abstract concepts with no physical referent, not the default for every card.

When a page has multiple card sections (e.g. a features grid and an "under the hood" architecture grid), apply the exact same photo-card treatment to both rather than photographing one section and leaving the other as icons — inconsistent treatment across sections reads as unfinished even if each section looks fine in isolation. Concretely: reuse one pattern everywhere — photo as the card's background layer, one consistent dark-gradient overlay for text legibility, icon + heading + body copy layered on top. This keeps the icon system's role (fast recognition) while photography carries the "this is real" weight.

## Make the treatment visible, not just present

A "subtle" photo treatment can tip into invisible. If a background photo is faded under a heavy gradient (e.g. under ~20% opacity with a near-opaque color wash on top), verify by rendering it — it's easy to end up with a photo that's technically in the code but not perceptible on screen, which fails the actual goal (visible evidence, warmth, trust) while still looking "correct" in the markup. Check opacity/overlay combinations against the rendered output, not just the CSS values in isolation. A photo that adds real signal usually needs 40–100% visible presence in its own frame (e.g., a photo card sitting on the page) rather than 10–20% opacity bleeding into a background.

## One consistent treatment across every photo

Every photograph in the product should share one visual treatment, chosen once and applied everywhere:
- A single color grade or duotone overlay derived from the token palette (e.g., a graphite-to-transparent gradient overlay so photos always sit comfortably against the brand's ink/paper tokens)
- Consistent crop ratio and framing logic (e.g., always a tight, human-scale crop rather than wide establishing shots in some places and close-ups in others)
- Consistent contrast/exposure level — don't let one photo run high-contrast and moody while another is flat and bright

Without this, a page can look like it was assembled from five different stock libraries even if every individual photo is high quality.

## Avoid stock-photo cliché

The generic "diverse group smiling at a laptop," "handshake in a blazer," or "person pointing at a whiteboard" genre of stock photography actively damages credibility — it reads as filler rather than evidence, and sophisticated B2B/enterprise buyers recognize it instantly. Prefer:
- Photography that shows the actual product/hardware/environment in believable, specific use — a real till, a real scan, a real stockroom — over posed generic office photography
- Candid framing over posed-and-smiling framing
- Specificity over abstraction: a photo of a barcode scanner mid-scan says more than a photo of two people shaking hands

## Licensing discipline — never optional

Applies to **downloaded**, **generated**, and **hyperlinked** images alike. Only use imagery with a clear, actual usage right:
- A properly licensed stock source (commercial-use covering download *or* hotlink/CDN use, as applicable)
- Commissioned/original photography
- Generated imagery only when the tool/terms allow commercial use of the output
- Hyperlinked remote images only when the host/URL is an intentional, rights-cleared source (your CDN, licensed stock CDN, partner asset) — not a scrape of "found on Google Images"
- Never fabricate a photo credit or attribution

If the actual usage rights for a specific photo can't be confirmed, don't ship it — download or generate a confirmed-licensed alternative, or fall back to illustration/3D render.

## Loading behavior (ties to state-coverage-edge-cases)

- Always set explicit width/height (or aspect-ratio) on image elements to prevent layout shift while loading
- Use a blur-up placeholder or a solid brand-color placeholder block, not a blank white flash, while the image loads
- Lazy-load any image below the first viewport
- Always write real, specific alt text describing what's in the image and why it matters in context — not the filename, not "image of product"

## Pre-ship checklist
- [ ] Each image was sourced deliberately via download, generation, or hyperlink — and that choice is noted when handing off
- [ ] The imagery medium (photo / render / illustration) was chosen deliberately per section, not defaulted to whatever was easiest to find
- [ ] Every card describing something real-world (hardware, environment, mechanism) uses a photo, not just an icon — icon-only is reserved for genuinely abstract cards
- [ ] All card sections on the page share one photo-card pattern — no section left as icons-only while another gets photography
- [ ] Every photograph on the page shares one consistent color treatment and crop logic
- [ ] Photo visibility was checked against the rendered page, not just the CSS — nothing is faded to the point of being imperceptible
- [ ] No generic posed/smiling stock-photo cliché imagery is used
- [ ] Every image's usage rights are confirmed and licensed (including generated-output terms and hyperlinked CDN rights), with no fabricated attribution
- [ ] Every image has explicit dimensions/aspect-ratio, a loading placeholder, and specific alt text
