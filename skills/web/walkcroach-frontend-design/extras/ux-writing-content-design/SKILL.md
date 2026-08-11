---
name: ux-writing-content-design
description: Expert UX writing and content design for interface text — button labels, headings, empty/error/success states, form microcopy, tooltips, and domain-specific terminology. Use this skill whenever writing or reviewing any words that appear IN a UI (not marketing copy — see landing-page-conversion-patterns for that) — button text, navigation labels, error messages, confirmation copy, placeholder text, onboarding steps, tooltips. Establish the product's terminology and voice once, then apply it consistently everywhere.
---

# UX Writing & Content Design

UI copy is functional, not persuasive — its job is to help someone complete a task with zero re-reading, not to sell them on doing it. Treat every string in an interface as a design element with the same rigor as spacing or color, not an afterthought filled in after the layout is done.

## The three tests every string must pass

- **Clear**: a user should never have to re-read a line to understand it. Plain vocabulary, short sentences, active voice. If a sentence needs a second pass, rewrite it — don't assume the user will try harder.
- **Concise**: every word earns its place. Cut filler ("please," "simply," "just" used as a hedge) unless it's doing real politeness work in a high-stakes moment (an error, a destructive action). Default to fewer words, not more.
- **Contextual**: the same underlying message needs different wording depending on where the user is and what state they're in. A validation error during onboarding reads differently than the same error mid-transaction — match the copy to the user's likely emotional state (curious/excited during onboarding, frustrated/anxious during an error, focused during a routine task), not just the literal event.

## Establish terminology once, in a glossary — before writing individual strings

Before writing any copy, fix the product's core nouns and verbs and never deviate: is it a "customer" or a "client" or a "user"? Is the person who processes a sale a "cashier," "operator," or "agent"? Is a "register," "till," and "terminal" the same thing or three different things? Inconsistent terminology (a table called "Customers" on one screen and "Clients" on another) reads as a bug even when it's just a word choice, and it's one of the most common, most avoidable UX writing failures at scale. Keep this glossary alongside the design tokens (see design-token-discipline) as a first-class product artifact, not a personal note.

## Voice and tone: one voice, many tones

- **Voice** is constant across the whole product — the product's personality (e.g., precise and calm for a security tool, warm and encouraging for a consumer wellness app). Decide it once.
- **Tone** flexes by context within that fixed voice: reassuring during an error, brisk during a routine confirmation, encouraging during onboarding. What never flexes is vocabulary level, sentence rhythm, or formality register — if error messages sound formal while buttons sound casual, the mismatch is noticeable and erodes trust even if neither individually is wrong.
- Match tone to domain stakes: a financial, security, or health product should lean toward reassurance and precision over playfulness — cleverness in a fintech error message reads as flippant, not friendly. A lower-stakes consumer/lifestyle product has more room for personality.

## Buttons and labels: specific and action-oriented

Never ship a bare "Submit," "OK," or "Next" when a specific verb phrase is available — "Save changes," "Send invite," "Delete register" tells the user exactly what happens next without them needing to trace back to the surrounding context. The button label should make sense read in isolation, since that's often how users actually scan a screen. Use sentence case (not Title Case or ALL CAPS) for buttons and headings as the current default — it reads faster and feels less shouty; pick one capitalization rule and apply it everywhere.

## Errors: explain, don't blame, and always give a next step

- Never blame the user ("You entered an invalid value") — describe the situation and the fix ("Enter a value between 1 and 100").
- Be specific about what happened and vague about internals: "We couldn't save your changes — check your connection and try again" beats both an unhelpful "Something went wrong" and an overly technical "Error 500: sync failure at node 4."
- For security-sensitive errors (login, account access), be deliberately generic where specificity would leak information — "Incorrect email or password" rather than confirming which one was wrong (see auth-page-design for the full reasoning).
- Every error needs a next action, not just a diagnosis — a dead-end error message with no path forward is a design failure, not just a copy one.

## Empty, loading, and success states need their own copy — not a placeholder

- **Empty states** should explain what will appear here and give a clear first action ("No registers yet — add your first one" beats "No data"). See state-coverage-edge-cases for the full pattern.
- **Loading states**, if they carry text at all, should describe what's happening in plain terms ("Syncing your sales data…") rather than generic "Loading…" when there's room for it to be more specific.
- **Success/confirmation copy** should be brief and specific about what just happened ("Register 04 deactivated" beats "Success!") — specificity here builds confidence that the system did the right thing.

## Forms: anticipate hesitation before it happens

Write field hints and helper text to answer the question a user is likely to have at that exact field, before they have to guess or abandon the form — a password field's helper text stating the actual requirement ("At least 8 characters, one number") prevents a failed attempt rather than explaining one after the fact. Keep instructional copy directly next to the field it describes, not in a separate instructions block above the form.

## Accessibility and inclusivity in copy itself

- Avoid idioms, culturally-specific references, and unnecessary jargon that don't translate or localize well, even in an English-only product — plain language serves non-native speakers and screen-reader users alike.
- Write link and button text that makes sense out of context for screen-reader users navigating by links list — "View report" beats a bare "Click here" or "Learn more" repeated identically across a page.
- Numbers, dates, and currency should follow the audience's actual locale convention, not be hardcoded to one region if the product serves several.

## A lightweight process, not a one-shot pass

Treat UX writing the way design-critique-polish-workflow treats visuals: draft copy alongside the layout (not after it's finalized), review it against the glossary and voice/tone rules, and revise based on how it actually reads once placed in the real component — a label that looks fine in a spec document can still be too long once it's inside an actual 120px-wide button. Keep a centralized copy reference (alongside the design tokens) so terminology and patterns for recurring elements (all error messages, all empty states, all confirmation toasts) stay consistent as the product grows, rather than being reinvented screen by screen.

## Pre-ship checklist
- [ ] Core product nouns and verbs are fixed in a glossary and used identically across every screen — no silent synonyms for the same concept
- [ ] Every button/label is a specific verb phrase, not a bare "Submit"/"OK"/"Next," and makes sense read in isolation
- [ ] Tone shifts appropriately by context (error vs. onboarding vs. routine) while voice, formality, and vocabulary level stay constant
- [ ] Every error message explains the situation, avoids blaming the user, and gives a next action — with deliberate vagueness only where specificity would leak sensitive information
- [ ] Empty, loading, and success states each have their own specific copy, not generic placeholders
- [ ] Form helper text answers the likely question at the field itself, before submission, not only after an error
- [ ] Copy avoids idioms and untranslatable references; interactive text makes sense out of context for screen readers
- [ ] Terminology and recurring patterns (all errors, all empty states) are checked against a shared glossary/style reference, not written fresh each time
