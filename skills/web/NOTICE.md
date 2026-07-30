# WalkCroach Web Skills — Provenance, Licenses & Why Scripts Exist

**Date:** July 2026 (revised — maximize utilities)

## Why this revision exists

Anthropic’s Agent Skills design ([Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)) is explicit:

> Skills can also include **code for [the agent] to execute as tools**. …certain operations are better suited for traditional code execution. …many applications require the **deterministic reliability that only code can provide**. …[the agent] can run this script **without loading either the script or the [file] into context**.

A skill that is only a `SKILL.md` is an onboarding guide. A skill with **`scripts/`** is a production capability: validate OOXML, rasterize for visual QA, enforce HD image placement, assert Reel still dimensions — repeatably, in Lambda, without burning tokens on byte-level checking.

WalkCroach’s first skill pass under-weighted that. This tree now maximizes utilities:

1. **Full Apache-2.0 packages** vendored (fonts, themes, GIF core, comms examples).
2. **WalkCroach-owned executable scripts** for document/creative QA (clean-room; not copies of Anthropic proprietary document scripts).
3. **SKILL.md files rewritten** to treat scripts as mandatory pipeline steps.

## License split (non-negotiable)

### May vendor & ship (Apache-2.0)

Mirrored under `vendor/apache/` and/or promoted into WalkCroach skill folders:

| Package | What we use |
|---|---|
| `canvas-design` | Design philosophy pattern + **`canvas-fonts/`** (OFL TTFs, incl. Bricolage) → `walkcroach-creative-philosophy/assets/fonts/` |
| `theme-factory` | **`themes/*.md`**, `theme-showcase.pdf` → `walkcroach-theme-factory/assets/` |
| `brand-guidelines` | Pattern only; WalkCroach Graphite Lumen rewrite |
| `frontend-design` | Pattern → `walkcroach-frontend-design` |
| `slack-gif-creator` | **Entire `core/` Python utilities** → `walkcroach-slack-gif/` |
| `internal-comms` | **`examples/`** progressive refs → `walkcroach-internal-comms/` |

### Must NOT copy into product (Proprietary Anthropic document skills)

`pptx/`, `pdf/`, `docx/`, `xlsx/` under Anthropic’s repo include `LICENSE.txt` that **forbids** extracting, copying, creating derivatives, or distributing those materials outside Anthropic Services.

README calls them “source-available … for **reference**.” Reference ≠ redistributable SDK.

**Therefore WalkCroach does not vendor Anthropic’s `validate.py`, `thumbnail.py`, OOXML helpers, or PDF form scripts.** We studied their *capability surface* (what deterministic steps a production creative skill needs) and implemented **original** WalkCroach scripts:

| WalkCroach script | Role (parity of capability, not code) |
|---|---|
| `walkcroach-pptx/scripts/validate_pptx.py` | Package/content QA |
| `walkcroach-pptx/scripts/thumbnail_pptx.py` | Visual grid via LibreOffice |
| `walkcroach-pptx/scripts/add_hd_image.py` | No silent upscales |
| `walkcroach-pdf/scripts/pdf_to_images.py` | PDF → PNG for QA/preview |
| `walkcroach-flyer/scripts/check_flyer_pdf.py` | Flyer PDF sanity |
| `walkcroach-image-gen/scripts/check_image_asset.py` | Canvas output sanity |
| `walkcroach-video-studio/scripts/assert_reel_still.py` | 1280×720 Reel gate |

Research checkout remains at `docs/research/anthropic-skills-tmp/` for humans — **not** packaged into Lambda.

## Runtime model (how WalkCroach uses scripts)

```
skills/web/**/SKILL.md     → progressive load into Nova context (metadata → body → refs)
skills/web/**/scripts/**   → NOT dumped into context; executed in lambda-creative
skills/web/**/assets/**    → mounted read-only in creative container (fonts, themes)
vendor/apache/**           → attribution mirror + optional deeper refs
```

`packages/agent-engine` skill loader already **skips** `scripts/` directories when indexing markdown (correct — scripts are for execution). Web Modules Phase A must:

1. Bake `skills/web` into the **lambda-creative** image (or layer).
2. Expose tool wrappers: `run_skill_script({ skill, script, args })` with allowlist.
3. Make `render_pptx` / `render_flyer` **fail closed** if validate/thumbnail scripts fail.

## Catalog

See each `walkcroach-*/SKILL.md`. High-leverage executable skills: pptx, flyer, pdf, image-gen, video-studio, slack-gif.
