---
name: accessibility-contrast-standards
description: Enforces WCAG/APCA contrast standards, color-independent communication, and keyboard/screen-reader accessibility for enterprise UI. Use this skill whenever choosing colors, building forms, reviewing a UI for accessibility, working on regulated-industry products (healthcare, finance, government, education), or whenever the build needs to be described as "enterprise-grade" or "professional" — accessibility compliance is a baseline requirement for that bar, not an optional add-on.
---

# Accessibility & Contrast Standards

Accessibility isn't a separate polish pass — for enterprise, healthcare, government, or education products it's often a legal requirement (WCAG 2.2 AA, Section 508), and it's also simply what "professional" means: interfaces that work for everyone, including keyboard-only and screen-reader users.

## Contrast requirements

- **Minimum floor (WCAG 2.2 AA)**: 4.5:1 contrast for normal body text, 3:1 for large text (18pt+/14pt bold+) and for UI components/graphical objects (borders, icons, focus indicators).
- **Better standard where available**: use APCA (Advanced Perceptual Contrast Algorithm) instead of the legacy WCAG ratio when your tooling supports it — it's more accurate, especially on dark themes and thin/light font weights, which the legacy ratio systematically mis-scores. Target Lc ≥75 for body text, Lc ≥45 for large/bold text, Lc ≥30 for non-text UI like icons and borders.
- **Measure every text/background pairing programmatically** before shipping — don't eyeball contrast, especially for text placed over images, gradients, or brand colors. Text over a photo or gradient needs a semi-transparent overlay to guarantee the contrast floor is met everywhere the text can land, not just where it happened to look fine in one screenshot.

## Never convey meaning by color alone

A red border on an invalid form field is not sufficient on its own — pair every color-coded state with an icon, text label, or shape so colorblind users (roughly 1 in 12 men) aren't excluded. This applies to status badges, chart legends, form validation, and any "green = good, red = bad" pattern.

## Keyboard and screen-reader baseline

- Every interactive element (button, link, input, custom dropdown) must be reachable and operable via keyboard alone (Tab, Enter, Space, Arrow keys as appropriate) — this is a common gap in custom-built components that don't use native `<button>`/`<a>` elements underneath.
- Visible focus indicators must be present on every focusable element and meet the 3:1 UI-component contrast floor — do not remove `outline` styles without providing an equally visible replacement.
- Icon-only buttons and controls need an `aria-label` or equivalent accessible name — a screen reader user gets nothing from an SVG with no text alternative.
- Form fields need programmatically associated labels (`<label for>` or `aria-labelledby`), not just visually adjacent text.

## Motion and animation

Respect `prefers-reduced-motion` for any non-essential animation — auto-playing transitions, parallax, or large motion effects should be dampened or disabled for users who've set this preference at the OS level.

## Pre-ship checklist
- [ ] Every text/background color pair on the page meets or exceeds the 4.5:1 (body) / 3:1 (large text, UI components) floor — checked with a tool, not by eye
- [ ] Every color-coded status, badge, or chart element also carries a non-color signal (icon, label, pattern)
- [ ] Full keyboard navigation works end-to-end for every interactive flow, with visible focus states throughout
- [ ] Every icon-only control has an accessible name
- [ ] Every form input has a properly associated label
- [ ] Non-essential motion respects `prefers-reduced-motion`
