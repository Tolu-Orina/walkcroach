# WalkCroach color system research (Jul 2026)

## Verdict (current)

**Graphite Lumen** — cool graphite canvas, **amber gold** CTA, **steel blue** secondary.  
Green/chartreuse was retired after visual review (utilitarian, especially in light mode).

Reject: purple/indigo “AI default”, cream+terracotta “editorial default”, forest/sage green UI.

## What the research says

### Glassmorphism needs chroma behind the glass
Frosted UI only reads as premium when the backdrop has light, color, or photographic depth. Flat near-black mud makes glass look dirty. Pattern in 2026: **glass for hero/chrome**, **opaque for dense app UI**; glass fill ~30–70% white/black alpha + 1px light border; text contrast ≥ ~7:1 on darkest glass.

### 60 / 30 / 10 still wins
- **60%** dominant neutral (charcoal / soft page)
- **30%** secondary surface (raised panels, borders)
- **10%** accent (CTA, focus, key status)

### Psychology for WalkCroach
| Hue | Signal | Fit |
|-----|--------|-----|
| Charcoal / graphite | Premium, technical gravity | Primary canvas |
| Amber / gold | Luxury conversion, warmth | CTA / focus only (≤10%) |
| Steel blue | Clarity, data, trust | Memory / persistence / secondary |
| Coral | Urgency | Errors only |

Charcoal + gold is a proven premium pair; steel blue keeps a tech “memory/data” cue without forest green.

### Competitors trap
Azure↔magenta gradients and indigo CTAs dominate AI landings. WalkCroach should feel **precise and durable**, not another violet agent.

## Options considered

1. **Forest + neon lime** — On-brand historically but muddy; glass fails.  
2. **Obsidian Loom (chartreuse + teal)** — Tried; green felt utilitarian in light mode.  
3. **★ Graphite Lumen (chosen)** — Graphite canvas, amber CTA, steel secondary.

## Graphite Lumen tokens

### Dark
| Token | Hex | Role |
|-------|-----|------|
| ink | `#0B0C0F` | Canvas |
| panel | `#14161B` | Panels |
| raised | `#1C1F26` | Elevated |
| line | `#2E333C` | Borders |
| mist | `#9198A4` | Secondary text |
| paper | `#F2F3F5` | Primary text |
| signal | `#F0B429` | CTA / brand pulse (≤10%) |
| teal | `#6B9EFF` | Memory / links / info (steel; name kept) |
| ember | `#F07167` | Danger |

### Light
| Token | Hex | Role |
|-------|-----|------|
| ink | `#F4F5F7` | Canvas |
| panel | `#FFFFFF` | Panels |
| raised | `#EBEEF2` | Elevated |
| line | `#D0D4DC` | Borders |
| mist | `#5C6470` | Secondary text |
| paper | `#12141A` | Primary text |
| signal | `#C48A0A` | CTA (darker for WCAG on light) |
| teal | `#3B6FD4` | Secondary |
| ember | `#C2410C` | Danger |

### Usage rules
1. Signal never as large fills — buttons, focus rings, small brand marks.  
2. Atmosphere: cool graphite + soft amber/steel washes *behind* glass.  
3. Body text sits on opaque or strong-glass; never thin mist on neon.  
4. Selection / focus use signal; informational chips use teal (steel).  
5. CTA text: dark ink on signal (both themes).

## Library note
Landing motion/glass: **Motion + custom glass tokens**.  
App chrome: **shadcn/Radix** for accessible primitives — not for inventing brand color.
