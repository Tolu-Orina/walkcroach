---
name: react-shadcn-component-architecture
description: Enterprise-grade component architecture for React + Tailwind CSS + shadcn/ui — folder structure, ownership model, CVA-based variant systems, and theming through design tokens. Use this skill whenever building or reviewing a React app on Tailwind and shadcn/ui, setting up a new design system, adding component variants, or theming/rebranding an existing shadcn-based app. Pair with design-token-discipline for the underlying color/spacing/radius values.
---

# React + Tailwind + shadcn/ui Component Architecture

shadcn/ui is not an installed dependency — components are copied into the codebase, which means the team owns and must maintain them. Treating it like a normal npm library (importing, never touching) throws away its main advantage and leads to drift as the project grows.

## Folder structure — separate raw, adapted, and composed

Keep three tiers, never flatten them into one `components/` folder:
```
components/
├─ ui/          # raw shadcn primitives, as close to stock as possible
├─ primitives/  # lightly modified shadcn components (project-specific variants added via CVA)
└─ blocks/      # product-level compositions (PricingCard, DataTableToolbar, etc.) built from ui/ and primitives/
```
This separation keeps `npx shadcn add <component>` safe to re-run on `ui/` without destroying project-specific customization, and makes it obvious where to look when extending something.

## Variants live in CVA, not scattered conditionals

Every shadcn component already ships with a `cva()` call defining its variants (`variant`, `size`, etc.). Extend that call directly rather than adding one-off conditional `className` logic in consuming components:
```tsx
const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // add project-specific variants here, not as ad hoc classes at call sites
        brand: "bg-brand text-brand-foreground hover:bg-brand/90",
      },
      size: { default: "h-9 px-4 py-2", xl: "h-12 px-8 py-3 text-lg" },
    },
  }
)
```
Use CVA sparingly — not every component needs a variant system. Adding CVA to a component with one visual state is unnecessary complexity; reserve it for components that genuinely have multiple controlled states (buttons, badges, alerts, cards with intent-based coloring).

## Theme through CSS variables, not scattered hex values

Rebrand or reskin by changing the HSL/OKLCH values in the global CSS file once — every shadcn component reads the same variables (`--primary`, `--background`, `--radius`, etc.), and dark mode should be automatic through a `.dark` class scope rather than a second hardcoded palette. Never hardcode a raw Tailwind color class (`bg-blue-600`) inside a component when a semantic token (`bg-primary`) already exists for that role — hardcoded values are what breaks the moment the palette changes.

## Don't break Radix accessibility to chase a look

shadcn's primitives are built on Radix UI (or Base UI in newer setups), which handles ARIA attributes, keyboard navigation, and focus management under the hood. When customizing appearance — especially for glassmorphism or heavy motion — never strip or override the underlying `role`, `aria-*`, or focus-trap behavior to get a visual effect to work. If a visual treatment (e.g. a fully transparent overlay) fights the accessibility layer, fix the visual treatment, not the accessibility primitive.

## Composition over prop explosion

When a `blocks/` component needs many visual permutations, compose smaller primitives rather than adding an ever-growing list of boolean props to one component (`showIcon`, `showBadge`, `compact`, `bordered`...). A component with more than ~5-6 boolean props is usually several components wearing a trench coat — split it.

## Motion belongs in a thin wrapper, not inside the primitive

Keep Framer Motion (or other animation) logic in a wrapper component around a shadcn primitive rather than editing the shadcn source file directly — this keeps `ui/` re-runnable via the CLI and keeps motion logic auditable in one place. See framer-motion-micro-interactions for motion-specific guidance.

## Pre-ship checklist
- [ ] Raw shadcn components in `ui/` are unmodified or minimally modified; project variants live in `primitives/` or the component's own `cva()` call
- [ ] No hardcoded hex/Tailwind palette classes where a semantic token already exists
- [ ] Rebranding the app requires touching only the CSS variable definitions, not individual components
- [ ] No component's accessibility primitives (ARIA, focus trap, keyboard handling) were altered to achieve a visual effect
- [ ] Components with many boolean props have been reconsidered as compositions of smaller pieces
