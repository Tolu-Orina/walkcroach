/**
 * Bundled Agent Skills registry seed.
 * Official CockroachDB skills ship as cockroachdb-official.generated.json and
 * are loaded at SkillsRegistry.init (keeps the IDE JS bundle lean).
 * One WalkCroach-specific companion skill covers MCP vs ccloud tool routing.
 * WALKCROACH_CODING_SKILLS covers general (non-CockroachDB) software-engineering
 * recipes/pitfalls — seeded so the agent doesn't have to reconstruct proven
 * setups (or rediscover known silent-failure classes) from possibly-stale
 * training knowledge on every task. Batch 1: Vite+React+Tailwind scaffolding
 * and type-only-export pitfalls. Batch 2: env-var pitfalls, debugging
 * discipline, CockroachDB app-connection recipe, and a security checklist.
 * Batch 3: 20 general agentic-coding practice skills (testing, debugging,
 * git/review, planning, and integration) curated from the wider Agent
 * Skills ecosystem — original WalkCroach-authored content, see the batch's
 * own comment below for provenance.
 */

export type BundledSkill = {
  name: string;
  description: string;
  body: string;
  /** Optional L3 reference markdown (filename → contents). */
  references?: Record<string, string>;
  /** Provenance string for NOTICE / debugging. */
  origin?: string;
};

/** WalkCroach surface-specific routing (not in upstream skills repo). */
export const WALKCROACH_COMPANION_SKILLS: BundledSkill[] = [
  {
    name: 'cockroachdb-walkcroach-tools',
    description:
      'Chooses WalkCroach CockroachDB tools: cockroach_mcp for interactive schema/data, ccloud for cloud lifecycle, and load_skill for official CockroachDB Agent Skills. Use when deciding how to query, migrate, or operate CockroachDB from WalkCroach IDE/CLI.',
    body: `# WalkCroach × CockroachDB tool routing

## Prefer
1. \`load_skill\` with an official CockroachDB skill name from the catalog (schema, SQL, observability, security, MOLT, ops).
2. \`cockroach_mcp\` for interactive read-mostly schema/data exploration (Managed MCP).
3. \`ccloud\` only for Cloud provisioning/lifecycle (\`-o json\`), always approval-gated.

## Do not
- Auto-approve \`ccloud\` or MCP writes.
- Invent DDL without reading schema first.
- Skip \`verify\` after mutating SQL when \`.walkcroach/verify.json\` lists checks.

## Official skills
Upstream skills ship from https://github.com/cockroachlabs/cockroachdb-skills (Apache-2.0). Call \`load_skill\` by name — bodies include progressive \`references/\` when present.
`,
    origin: 'walkcroach:companion',
  },
];

/** General (non-CockroachDB) software-engineering recipes/pitfalls. */
export const WALKCROACH_CODING_SKILLS: BundledSkill[] = [
  {
    name: 'scaffolding-vite-react-ts-tailwind',
    description:
      "Exact proven recipe for scaffolding a new Vite + React + TypeScript + Tailwind CSS v4 project from scratch, sourced from this repo's own working web/ app. Use when asked to create/scaffold/bootstrap a new React web app, frontend project, or similar (e.g. 'create a todo app', 'scaffold a dashboard'). Covers Tailwind v4's CSS-first setup (no tailwind.config.js) and the tsconfig flag that prevents silent Vite runtime import errors.",
    body: `# Scaffolding a Vite + React + TypeScript + Tailwind v4 app

## Steps

1. Scaffold **non-interactively** — interactive prompts hang a non-interactive agent terminal:
   \`\`\`
   npm create vite@latest <name> -- --template react-ts
   \`\`\`
2. \`cd <name> && npm install\`
3. Add Tailwind **v4** — this is not the v3 flow:
   \`\`\`
   npm install tailwindcss @tailwindcss/vite
   \`\`\`
   Do **not** run \`npx tailwindcss init\` — v4 has no CLI-generated config step.
4. Wire the plugin into \`vite.config.ts\`:
   \`\`\`ts
   import { defineConfig } from 'vite';
   import react from '@vitejs/plugin-react';
   import tailwindcss from '@tailwindcss/vite';
   export default defineConfig({ plugins: [react(), tailwindcss()] });
   \`\`\`
5. Replace the generated CSS entrypoint's contents with:
   \`\`\`css
   @import "tailwindcss";
   \`\`\`
   That is the whole v4 setup — no \`tailwind.config.js\`, no \`content\` globs. Use \`@theme { ... }\` in that same CSS file only if custom design tokens are needed.
6. In \`tsconfig.app.json\`, ensure \`"verbatimModuleSyntax": true\` is set. This is not optional — see the \`avoiding-vite-type-only-export-errors\` skill for why.
7. Verify: \`npm run build\` (\`tsc -b && vite build\`) and lint if configured. **A clean build does not prove the app renders correctly.** Two known silent-failure modes to double-check by inspection, not just by trusting the build:
   - Forgetting the \`tailwindcss()\` plugin in step 4 makes every Tailwind class a silent no-op — blank/unstyled page, zero errors anywhere.
   - Type-only exports imported without \`import type\` — see \`avoiding-vite-type-only-export-errors\`.

## Common mistakes

- Hand-writing \`package.json\`/\`vite.config.ts\`/\`tsconfig.json\` from memory instead of using the generator plus these minimal patches — risk of stale or incompatible dependency combinations.
- Mixing Tailwind v3 syntax (\`@tailwind base;\` etc., a \`tailwind.config.js\`) into a v4 install.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'avoiding-vite-type-only-export-errors',
    description:
      "Explains why 'Uncaught SyntaxError: does not provide an export named X' happens in Vite for TypeScript projects, and the tsconfig flag that catches it at compile time instead of at runtime. Use when creating/editing TypeScript files whose types get imported elsewhere, after scaffolding a new Vite+TS project, or when debugging a browser console error mentioning 'does not provide an export'.",
    body: `# Avoiding Vite "does not provide an export named X" errors

## Root cause

Vite/esbuild transpile each file **in isolation**, without whole-program type information. \`import { Todo } from './types'\` where \`Todo\` is \`export interface\`/\`export type\` can get silently stripped, only failing when the browser tries to load that named export at runtime. \`tsc -b\` and \`vite build\` both pass cleanly if \`verbatimModuleSyntax\`/\`isolatedModules\` isn't set, because that import is otherwise valid TypeScript — this is what makes the bug silent.

## Prevention

Set this in \`tsconfig.app.json\` (or the relevant tsconfig) on every new Vite+TS project — already set this way in this repo's own \`web/tsconfig.app.json\`, copy it:

\`\`\`json
{ "compilerOptions": { "verbatimModuleSyntax": true } }
\`\`\`

This makes \`tsc\` **error at typecheck time** on any type-only import missing the \`type\` keyword — converting the bug from "silent runtime failure a user reports later" into "caught by \`npm run typecheck\` before you're done."

## Correct import forms once the flag is on

- Type-only: \`import type { Todo } from './types'\`
- Mixed value + type from the same module: \`import { type Todo, someValue } from './types'\`

## Diagnostic checklist

If this error is ever reported (in a console, a bug report, or a log):
1. Grep the named module for \`export interface <Name>\` / \`export type <Name>\`.
2. Grep every importer of that module for a plain \`import { <Name>\` (no \`type\`) referencing it — that's the bug.
3. Fix by adding \`type\` to that import.
4. If the project doesn't already have \`verbatimModuleSyntax\`, enable it and re-run typecheck — every existing violation surfaces at once as compile errors, rather than one at a time as runtime crashes.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'avoiding-vite-env-var-runtime-pitfalls',
    description:
      "Explains why process.env.X is undefined in Vite client code and the correct import.meta.env pattern, including the VITE_ prefix requirement and string-only values. Use when reading configuration/API keys/feature flags in a Vite app, or when debugging a variable that's mysteriously undefined or a boolean that's always truthy in the browser.",
    body: `# Avoiding Vite environment-variable runtime pitfalls

## Root cause

Vite client code runs in the browser, which has no \`process\` global. \`process.env.X\` is a Node.js/webpack convention; in Vite it is simply \`undefined\` at runtime, not a build error — code compiles and typechecks fine, then silently reads nothing in the browser.

## Correct pattern

- Read env vars via \`import.meta.env.VITE_X\`, never \`process.env.X\`, in any code that ships to the browser (components, hooks, client-side modules).
- Only variables prefixed \`VITE_\` are exposed to client code — this is deliberate (prevents accidentally bundling server secrets into the client build). An unprefixed var in \`.env\` is invisible to \`import.meta.env\`, not an error.
- \`import.meta.env\` values are always strings. \`import.meta.env.VITE_FEATURE_FLAG === "false"\` is truthy as a string — compare explicitly (\`=== 'true'\`), don't rely on JS truthiness.
- Built-in booleans \`import.meta.env.DEV\`, \`import.meta.env.PROD\`, and the string \`import.meta.env.MODE\` are provided automatically (no prefix needed, not user-defined).
- \`.env\` file precedence: \`.env.local\` > \`.env.[mode].local\` > \`.env.[mode]\` > \`.env\`, per Vite's mode (\`development\`/\`production\`). \`.env.local\` files are for machine-local overrides and are gitignored by default in Vite's own scaffold.

## Diagnostic checklist

If a variable reads as \`undefined\` or a flag behaves as always-true/always-false:
1. Confirm it's read via \`import.meta.env.VITE_...\`, not \`process.env...\`.
2. Confirm the var is actually prefixed \`VITE_\` in the \`.env\` file.
3. Confirm the dev server was restarted after editing \`.env\` — Vite does not hot-reload env var changes.
4. If comparing a flag, confirm the comparison is against the string \`'true'\`/\`'false'\`, not a bare truthiness check.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'systematic-debugging-discipline',
    description:
      'A disciplined process for diagnosing "it doesn\'t work" reports: reproduce first, read the actual error before hypothesizing, bisect rather than guess, change one variable at a time, and re-verify after each fix. Use when given a vague bug report with no clear cause, or after two or more failed fix attempts in a row on the same issue.',
    body: `# Systematic debugging discipline

## When to apply this

Any bug report without an obvious single cause, and especially after a first fix attempt didn't work — repeated guessing without a process is the actual failure mode to avoid, not the bug itself.

## Process

1. **Reproduce first.** Don't propose a fix for a bug you haven't triggered yourself. If it can't be reproduced, say so explicitly rather than guessing at a plausible-sounding cause.
2. **Read the actual error, completely**, before forming a hypothesis — the stack trace, the exact message, the line number. Don't pattern-match on a similar-sounding bug from memory and skip reading what's actually in front of you.
3. **Locate the smallest failing case.** If a large file/feature is implicated, narrow it: which function, which input, which line. Bisecting via \`git log\`/\`git bisect\` or by commenting out half the suspect code is faster and more reliable than reasoning about the whole system at once.
4. **Form one hypothesis, then test only that hypothesis.** Change exactly one variable before re-running. Stacking multiple speculative changes at once destroys the ability to know which change (if any) actually fixed it.
5. **Verify the fix actually fixes it** — re-run the original reproduction, not just a related-looking check (e.g. a passing build is not proof a runtime bug is gone; re-trigger the exact reported symptom).
6. **If two attempts have failed**, stop and re-read the error from scratch rather than trying a third variation of the same guess — that's a signal the working hypothesis is wrong, not that the fix needs more tweaking.

## Anti-patterns to avoid

- Fixing the first plausible-looking issue found while reading code, without confirming it's the cause of the *reported* symptom.
- Silencing an error (broad try/catch, ignoring a type error, disabling a lint rule) instead of finding the root cause.
- Declaring victory on a clean build/typecheck alone when the original report was about runtime behavior.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'connecting-scaffolded-app-to-cockroachdb',
    description:
      "Minimal, correct way to connect a freshly scaffolded app to CockroachDB: the pg client, a sslmode=verify-full connection string, and why the connection must live on a backend layer rather than in browser client code. Use when asked to 'connect this app to the database' or 'add CockroachDB' after scaffolding a new project.",
    body: `# Connecting a scaffolded app to CockroachDB

## Key constraint

CockroachDB (like any Postgres-wire database) cannot be queried directly from browser JavaScript — there is no browser-safe driver, and doing so would require shipping database credentials to every client. A Vite/React frontend needs a backend layer (a Node/Express API route, a serverless function, etc.) that holds the connection; the frontend calls that backend over HTTP, never the database directly.

## Setup

1. Install the \`pg\` driver on the **backend** package only: \`npm install pg\`.
2. Connection string goes in a server-side env var (e.g. \`CRDB_CONNECTION_STRING\` in \`.env\`, read via \`process.env\` in Node backend code — note this is Node, not Vite client code, so \`process.env\` is correct here, unlike \`avoiding-vite-env-var-runtime-pitfalls\`). Never hardcode credentials, never prefix this var with \`VITE_\` (that would expose it to the client bundle).
3. Require TLS verification, don't disable it: append \`sslmode=verify-full\` to the connection string (or pass equivalent \`ssl\` options to the \`pg\` client). Do not set \`sslmode=disable\` or \`rejectUnauthorized: false\` to work around a certificate error — fix the certificate/CA configuration instead.
4. Minimal working query:
   \`\`\`ts
   import { Pool } from 'pg';
   const pool = new Pool({ connectionString: process.env.CRDB_CONNECTION_STRING, max: 5 });
   const { rows } = await pool.query('SELECT $1::text AS msg', ['hello']);
   \`\`\`
   Always use parameterized queries (\`$1\`, \`$2\`, ...) — never string-concatenate user input into SQL (see \`security-checklist-for-new-code\`).

## Verify

Run a trivial query (\`SELECT 1\`) against the connection on startup or via a health-check endpoint, and confirm it succeeds before wiring up feature-specific queries — isolates connection/credential problems from query-logic problems.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'security-checklist-for-new-code',
    description:
      'Concrete, non-generic security checks scoped to what this agent actually writes: SQL parameterization, secret handling, trust-boundary validation, unescaped HTML, and risky dependency patterns. Use when finishing a feature that touches user input, authentication, or a new external dependency, before calling the task done.',
    body: `# Security checklist for new code

Run through this before calling a feature "done," specifically for code that touches user input, auth, or a new dependency — not a blanket checklist for every change.

## SQL
- Every query with a variable value uses parameterized placeholders (\`$1\`, \`$2\`, ... for \`pg\`; \`?\`/named params for other drivers). Never build SQL via string concatenation or template literals with user-controlled values.

## Secrets
- Never log full tokens, passwords, API keys, or connection strings — not even at debug level. If a value must be logged for diagnostics, log a redacted form (e.g. last 4 characters) or its presence/absence only.
- Never commit \`.env\` files or hardcode credentials in source; confirm new config reads from environment variables.

## Trust boundaries
- Validate/sanitize input at the boundary where untrusted data enters the system (an HTTP handler, a form submission, a webhook payload) — not redundantly at every internal function call downstream of that boundary.
- Don't render user-controlled strings as raw/unescaped HTML (e.g. \`dangerouslySetInnerHTML\` in React, \`innerHTML\` in vanilla JS) without sanitization — this is the direct XSS vector.

## Dependencies
- Before adding a new dependency, a quick sanity check is enough for this agent's scope: does it disable TLS verification by default, use \`eval\`/\`Function\` on untrusted input, or have an unusually small/inactive maintainer footprint for something security-sensitive (auth, crypto, parsing). Not a full audit — a red-flag scan.

## Auth
- Never implement custom password hashing/crypto from scratch — use an established library (e.g. \`bcrypt\`) with its defaults.
- Session tokens and equivalent credentials go in secure, httpOnly cookies or equivalent secure storage — not \`localStorage\`, which is readable by any script on the page (XSS-exfiltrable).
`,
    origin: 'walkcroach:builtin',
  },
  // --- Batch 3: general agentic-coding practice, curated from the wider
  // Agent Skills ecosystem (anthropics/skills, obra/superpowers [MIT],
  // community "awesome-claude-skills" lists). Topics/names are inspired by
  // those collections; bodies below are original WalkCroach-authored
  // content tailored to this engine's own tools and conventions, not
  // verbatim copies.
  {
    name: 'test-driven-development',
    description:
      'RED-GREEN-REFACTOR discipline: write a failing test first, write the minimum code to make it pass, then refactor with the test as a safety net. Use when implementing new logic with a clear expected behavior, or when fixing a bug that should get a regression test.',
    body: `# Test-driven development (RED-GREEN-REFACTOR)

## The cycle

1. **RED** — write a test for the behavior you're about to add, before the implementation exists. Run it and confirm it fails for the *expected* reason (missing function, wrong output) — not a typo or import error.
2. **GREEN** — write the minimum code to make that test pass. Resist adding anything the test doesn't require yet.
3. **REFACTOR** — with the test now passing and acting as a safety net, clean up the implementation (naming, duplication, structure) and re-run the test to confirm it still passes.

## Why the order matters

Writing the test first forces a concrete definition of "done" before implementation bias creeps in, and proves the test can actually fail (a test that's never been seen to fail might be vacuously passing — e.g. asserting on the wrong variable).

## For bug fixes specifically

Write the regression test to reproduce the reported bug *before* touching the fix. Confirm it fails the same way the bug report describes, fix the code, confirm the test now passes. This is what actually proves the fix addresses the reported symptom (see \`systematic-debugging-discipline\`).

## Anti-patterns

- Writing several tests then several implementations in a batch — loses the fast feedback loop that makes TDD useful.
- Skipping the refactor step under time pressure — this is where accumulated shortcuts get paid down; skipping it repeatedly is how codebases rot.
- Treating "the test passes" as sufficient without having watched it fail first for the right reason.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'condition-based-waiting',
    description:
      'Replaces arbitrary sleep()/setTimeout delays in tests and scripts with explicit poll-until-condition waiting, eliminating flaky async tests and slow fixed delays. Use when writing or fixing a test/script that waits on async state — a server starting, a DOM element appearing, a file being written.',
    body: `# Condition-based waiting instead of fixed sleeps

## The problem with \`sleep(N)\` / \`setTimeout\`

A fixed delay is always wrong in one of two directions: too short (flaky — fails intermittently on a slow CI runner) or too long (wastes time on every run, and still not guaranteed correct on an even slower run). It's guessing at a duration instead of checking the actual condition.

## The correct pattern

Poll for the real condition with a timeout, not a delay for its own sake:

\`\`\`ts
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  { timeoutMs = 5000, intervalMs = 50 } = {},
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}
\`\`\`

Use it against the thing actually being waited on: a port accepting connections, a DOM element matching a selector, a file existing on disk, an HTTP endpoint returning 200 — never "wait 2 seconds and hope."

## Where this applies in this codebase

- Terminal/PTY output: poll for a marker string in the output buffer, don't sleep a fixed duration after starting a command.
- Browser-based verification (see \`webapp-testing-with-playwright\`): wait for a selector or network idle state, not \`page.waitForTimeout(N)\`.

## Exception

A short fixed delay is acceptable only when there is no observable condition to poll (e.g. debouncing rapid-fire events) — and even then, prefer a documented reason over a magic number.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'testing-anti-patterns',
    description:
      'Catalog of common test-quality mistakes to catch in self-review: testing implementation details instead of behavior, brittle exact-match assertions, order-dependent tests sharing state, and overmocking. Use when writing new tests or reviewing existing ones, before calling a test suite done.',
    body: `# Testing anti-patterns

## Testing implementation, not behavior
Asserting on private internal state or call counts to unrelated helpers makes a test break on any refactor, even ones that don't change observable behavior. Assert on the public output/effect instead.

## Brittle exact-match assertions
Asserting an entire object/string matches exactly (including fields irrelevant to the test's purpose) breaks on any unrelated field addition. Assert only the fields the test is actually about, or use a partial matcher (e.g. \`expect.objectContaining\`).

## Order-dependent tests / shared mutable state
Tests that only pass when run in a specific order (because they share a module-level variable, a database row, a file) are a sign of missing isolation. Each test should set up and tear down its own state; don't rely on execution order.

## Overmocking
Mocking so much of the system under test that the test only proves the mocks were called correctly, not that the real code works. Mock at the boundary (network, filesystem, third-party SDK), not the logic being tested.

## No-assertion tests
A test that runs code and checks nothing (or only that no error was thrown) gives false confidence — an assertion on actual output is required to prove behavior, not just absence of a crash.

## Sleeping instead of waiting on a condition
See \`condition-based-waiting\` — this is the single most common source of test flakiness.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'webapp-testing-with-playwright',
    description:
      'Drives a real headless browser via Playwright to click through a web app, capture console errors, and verify actual rendered output — the only way to catch runtime/rendering bugs a clean build cannot. Use after scaffolding or changing a web app UI, especially to verify a fix for a reported visual or runtime bug (e.g. a silent console error, a blank page).',
    body: `# Testing a web app with Playwright

## Why this is necessary

A passing \`npm run build\`/typecheck proves the code compiles — it says nothing about whether the page actually renders correctly in a browser (see \`avoiding-vite-type-only-export-errors\` for a concrete example of a bug that only surfaces at runtime). Playwright closes that gap by actually loading the page.

## Minimal setup

\`\`\`
npm install -D @playwright/test
npx playwright install chromium
\`\`\`

## Minimal verification script

\`\`\`ts
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors: string[] = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(err.message));

await page.goto('http://localhost:5173');
await page.waitForSelector('#root', { state: 'attached' });

if (consoleErrors.length) {
  throw new Error(\`Console errors:\\n\${consoleErrors.join('\\n')}\`);
}
await browser.close();
\`\`\`

## What to check

1. **Console errors** — the exact class of bug this catches (e.g. \`Uncaught SyntaxError: does not provide an export named X\`).
2. **Visible content** — assert something meaningful is actually on the page (\`page.locator(...).isVisible()\`), not just "no crash" — a blank page with zero errors is still broken (e.g. the missing-Tailwind-plugin failure mode).
3. **Interaction** — for a reported bug involving a click/form/flow, script the exact steps from the report and assert the expected resulting state.

Always use \`waitForSelector\`/\`waitForLoadState\`, never a fixed delay — see \`condition-based-waiting\`.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'root-cause-tracing',
    description:
      'Technique for tracing a bug backward through the call/dependency chain to its true origin, instead of patching the first symptom encountered. Use when a fix keeps not working, or the same class of bug recurs at different call sites.',
    body: `# Root-cause tracing

## When the first fix doesn't stick

If patching the symptom at the point it was observed doesn't fully fix the bug, or the same failure mode shows up again elsewhere, the actual defect is upstream of where it was noticed.

## Process

1. Start at the point the bug is *observed* (an error message, a wrong value on screen).
2. Trace backward one call/data-flow hop at a time: what produced this value/state? Where did it come from?
3. At each hop, ask "is this hop's output correct given its input?" — if yes, move further upstream; if no, that hop is a candidate root cause, but keep tracing one more hop to make sure it isn't itself downstream of something else wrong.
4. Stop at the first point where the input was correct but the output was wrong — that's the actual defect.
5. Fix at that point, not at every downstream location the symptom showed up — a fix at the root usually eliminates all the downstream symptoms at once.

## Signal that you're patching a symptom, not a cause

- The same category of bug appears in more than one unrelated place — a shared upstream cause is likely.
- The fix requires special-casing a particular caller instead of correcting the underlying function/data.
- The fix "works" but you can't explain *why* the original code was wrong.

Pairs with \`systematic-debugging-discipline\` for the overall investigation loop.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'verification-before-completion',
    description:
      'Before declaring a task or fix done, re-run the exact originally-reported reproduction (not just build/lint/typecheck) and check for regressions in adjacent behavior. Use before returning any "done" status on a bug fix or feature, especially ones involving runtime behavior.',
    body: `# Verification before completion

## The gap a clean build doesn't close

Typecheck/lint/build passing proves the code compiles under the rules configured — it does not prove the originally reported problem is gone, or that nothing else broke. Treat "build succeeded" and "task verified" as two separate claims.

## Checklist before saying "done"

1. **Re-run the exact reproduction from the report** — the same input, the same steps, the same environment where possible. Not a similar-looking case; the actual one.
2. **Confirm the expected outcome**, not just "no error thrown." If the report showed a specific wrong value/behavior, confirm the new value/behavior is the correct one.
3. **Check immediately adjacent behavior** for regressions — code paths that share the changed function/component, not the whole codebase, but enough to catch an obvious side effect.
4. **Re-run the project's actual test/verify commands** (per \`.walkcroach/settings.json\` verify config if present) — don't assume they'd pass without running them.

## What this replaces

Declaring victory because "the code looks right" or because a build/typecheck was clean — both are necessary, neither is sufficient on its own for a runtime behavior claim.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'defense-in-depth-validation',
    description:
      'Validates critical invariants at multiple independent layers (input boundary, business logic, persistence) rather than trusting a single check — a later layer catches what an earlier one missed. Use when writing code where a validation bug would be costly: auth, payments, data integrity, or anything touching multi-tenant isolation.',
    body: `# Defense-in-depth validation

## The principle

For invariants that matter (a user can only access their own data, a monetary amount can't go negative, an ID is actually owned by the caller), validate the invariant at more than one layer, so a bug or bypass at one layer doesn't silently become a real-world failure.

## Typical layers for this codebase

1. **Input boundary** — an HTTP handler / tool input schema rejects malformed or out-of-range values before they reach any logic (e.g. this repo's Lambda handlers validating \`name\`/\`description\`/\`body\` length and shape before calling into \`agent-harness\`).
2. **Business logic** — the actual operation re-checks the invariant in terms it understands (e.g. \`assertOwnsProject(ownerId, projectId)\` before any project-scoped write, independent of whatever the input boundary already checked).
3. **Persistence** — database constraints (\`NOT NULL\`, \`UNIQUE\`, foreign keys, \`CHECK\`) as the last line of defense, catching anything that slipped past application code entirely (including future code that forgets the earlier checks).

## Where this is not appropriate

Don't apply this to every validation — re-checking a purely cosmetic UI constraint at three layers is wasted effort. Reserve defense-in-depth for invariants whose violation would be a security, financial, or data-integrity problem, not general input hygiene (which \`security-checklist-for-new-code\` already covers at the boundary).
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'using-git-worktrees',
    description:
      'Uses `git worktree` to check out multiple branches into separate directories simultaneously, avoiding stash/switch churn when juggling a fix and a feature in parallel. Use when asked to work on a second branch without disturbing uncommitted work on the current one.',
    body: `# Using git worktrees for parallel branches

## The problem it solves

Switching branches in the same working directory forces stashing or committing WIP first, and risks build artifacts / installed dependencies going stale on every switch. A worktree gives each branch its own directory, checked out simultaneously, sharing the same \`.git\` history.

## Commands

\`\`\`
git worktree add ../repo-hotfix hotfix-branch   # new dir, existing branch
git worktree add -b new-feature ../repo-feature main  # new dir + new branch from main
git worktree list                                # see all active worktrees
git worktree remove ../repo-hotfix               # done with it, clean up
\`\`\`

## When to reach for this

- An urgent fix is needed while a larger feature branch has uncommitted, not-yet-committable work.
- Running/comparing two branches' behavior side by side (e.g. before/after a refactor).

## Caveats

- Each worktree needs its own \`npm install\` / dependency setup — they don't share \`node_modules\` unless symlinked deliberately.
- Don't check out the same branch into two worktrees at once (git will refuse).
- Clean up with \`git worktree remove\` when done, rather than just deleting the directory — that leaves stale metadata in \`.git/worktrees\`.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'finishing-a-development-branch',
    description:
      'Checklist for closing out a branch cleanly: confirming it is rebased/mergeable, squashing incidental WIP commits into a coherent history, and choosing merge vs rebase vs PR appropriately. Use when a feature or fix is functionally complete and ready to land.',
    body: `# Finishing a development branch

## Before merging/opening a PR

1. **Rebase onto the latest target branch** (or confirm CI will do an equivalent check) — catch conflicts locally rather than in review.
2. **Review the commit history for the branch**, not just the final diff — a string of "wip", "fix typo", "actually fix it" commits should usually be squashed into commits that each represent one coherent, reviewable change. Use \`git rebase -i\` for this only with the user's explicit go-ahead (interactive rebase rewrites history).
3. **Re-run the full test/verify suite** on the final state, not just after the last individual commit — a squash or rebase can silently reorder changes in a way that breaks something.
4. **Write a PR/commit description focused on why**, not a restatement of the diff (see \`writing-clear-commit-messages\`).

## Merge strategy

- Prefer a normal merge or squash-merge for feature branches merging into a shared branch — preserves or simplifies history depending on team convention; check the repo's existing pattern (\`git log --graph\`) rather than assuming.
- Never force-push a branch other people have already based work on, without explicit coordination.

## After merging

Delete the now-merged branch (local and remote) once confirmed merged, to avoid stale branches accumulating — but only after confirming the merge actually landed, not preemptively.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'requesting-code-review',
    description:
      'Prepares a change for review: a clear description of what changed and why, a diff scoped to one concern, and a self-review pass before requesting others\' time. Use when a change is functionally complete and about to be handed off for review.',
    body: `# Requesting code review

## Before requesting review

1. **Self-review the full diff first**, as if reviewing someone else's PR — this catches leftover debug code, accidental unrelated changes, and missing tests before a reviewer has to point them out.
2. **Scope the diff to one concern.** A PR that bundles an unrelated refactor with the actual fix/feature is harder to review and harder to revert cleanly if something's wrong — split it if the two are genuinely separable.
3. **Write a description that explains why**, not just a restatement of the diff: what problem this solves, why this approach over alternatives considered, and anything a reviewer should pay special attention to (a risky edge case, a deliberate trade-off).

## What makes a diff easy to review

- Commits that tell a coherent story (see \`finishing-a-development-branch\`), not a flat pile of WIP commits.
- Tests included in the same PR as the behavior they verify, not a follow-up.
- Any non-obvious decision called out explicitly in the description or a code comment — don't make the reviewer reverse-engineer intent.

## What not to do

Don't request review on code that doesn't build, pass its own tests, or pass lint — that wastes reviewer time on issues automation would have caught.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'receiving-code-review-feedback',
    description:
      'How to process review comments without defensiveness or blind compliance: understand the concern behind each comment, push back with reasoning when a suggestion is wrong, and batch related fixups into one follow-up commit. Use when addressing PR review comments.',
    body: `# Receiving code review feedback

## Process each comment for the underlying concern

A review comment is a symptom of a concern, not necessarily the literal fix to apply. "This function is too long" might really mean "I can't tell what this does" — the fix might be extraction, or it might be a clearer name and a comment; understand the concern before picking the fix.

## Don't apply feedback blindly

If a suggested change is wrong (misunderstands the code, would introduce a bug, contradicts an already-agreed constraint), say so with the specific reasoning — reviewers miss context sometimes, and silently implementing something known to be wrong just to avoid friction is worse than a short disagreement.

## Don't get defensive either

A comment pointing out a real issue isn't a judgment of the author — fix it, and if the same category of issue recurs across the diff, fix all instances rather than only the one that was called out (that's more useful to the reviewer than making them find each occurrence).

## Batching fixes

Address related comments together in one follow-up commit with a clear message, rather than one micro-commit per comment — makes the resulting history readable rather than a play-by-play of the review conversation.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'writing-clear-commit-messages',
    description:
      'Structures commit messages around why a change was made, not just what changed — imperative-mood subject line, blank line, body explaining motivation and trade-offs. Use when committing any non-trivial change.',
    body: `# Writing clear commit messages

## Structure

\`\`\`
<imperative mood summary, ~50 chars, no trailing period>

<body: why this change, not what — the diff already shows what>
<any trade-offs considered, or context a future reader would want>
\`\`\`

## Subject line

- Imperative mood: "Fix race condition in X", not "Fixed" or "Fixes" — reads naturally as "This commit will ___".
- Specific enough to be findable in \`git log --oneline\` later — "Fix bug" is useless in a log of 500 commits.

## Body

- Focus on *why*, not *what* — the diff itself is the authoritative record of what changed; a reader with the diff in front of them doesn't need it restated in prose.
- Reference the motivating issue/context if there is one, but describe it (don't rely solely on an issue number that may later be unreachable).
- Call out anything non-obvious: a workaround for a specific bug, a deliberate simplification, an approach considered and rejected.

## What to avoid

- Vague messages ("update", "fix stuff", "wip") on commits meant to be part of permanent history — fine for true in-progress commits on a branch that will be squashed before merge (see \`finishing-a-development-branch\`), not for the final history.
- Commenting on the current task/PR/ticket in a way that won't make sense once that context is gone ("per Sarah's request in standup").
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'writing-implementation-plans',
    description:
      'Structures a plan before touching code: context/why, concrete design decisions with the files they touch, and a verification section — so scope is agreed before time is spent. Use for any multi-file or architecturally uncertain change before implementing.',
    body: `# Writing implementation plans

## When a plan is worth writing

Any change spanning multiple files, involving a genuine design decision (not just "the one obvious way to do it"), or where the requester's intent could reasonably be interpreted more than one way. A one-line bug fix doesn't need this.

## Structure

1. **Context** — why this change, what problem it solves, what prompted it. A plan without this is hard for anyone (including future-you) to evaluate.
2. **Design** — the concrete approach: which files change and how, mirroring existing patterns in the codebase rather than inventing new ones where a precedent exists. Name the specific functions/files being reused or extended.
3. **Verification** — how the change will actually be confirmed to work: which tests, which manual check, which command. A plan that ends at "implement the design" without saying how it'll be verified is incomplete.

## Before writing the plan

Research the actual codebase first — existing patterns, naming conventions, and precedents for similar work. A plan built on assumptions instead of what's actually there gets rejected or reworked once the gap surfaces.

## Getting it approved

Present the plan for confirmation before implementing, especially when it involves an architectural decision, touches shared/critical code, or the requester's intent was ambiguous enough that two reasonable people could plan it differently.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'executing-plans-with-checkpoints',
    description:
      'Executes a written multi-step plan in small, independently verifiable increments, confirming each step\'s outcome before starting the next, rather than making all changes then debugging in bulk. Use when carrying out an approved implementation plan with three or more steps.',
    body: `# Executing plans with checkpoints

## Why increments beat a single big change

Making every planned change and only then running tests/builds makes failures hard to attribute — which of ten changes broke the build? Verifying after each meaningful increment isolates failures to a small, recent diff, which is far faster to debug.

## Pattern

1. Break the plan into steps that are each independently buildable/testable (not necessarily one step per file — group changes that only make sense together).
2. After each step: run the relevant build/test/typecheck, not just at the very end.
3. If a step fails verification, fix it before moving to the next step — don't stack a second speculative change on top of an unverified one.
4. Track progress explicitly (e.g. a todo list) so a long plan doesn't lose track of what's done vs. pending, especially across a long session.

## When to deviate from the plan

If execution reveals the plan's assumption was wrong (a file doesn't exist where expected, a pattern doesn't apply the way assumed), stop and reconcile — either adjust the approach and note why, or flag it back to whoever approved the plan if the change in scope is significant, rather than silently improvising a different design.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'brainstorming-before-building',
    description:
      'Explores multiple approaches and their trade-offs before committing to one, especially when a request is ambiguous or under-specified — asking clarifying questions rather than guessing at intent. Use when a request could reasonably be implemented multiple different ways, or key requirements are unstated.',
    body: `# Brainstorming before building

## When to pause before implementing

A request is a candidate for this when: it could reasonably be built two or three meaningfully different ways with different trade-offs, or it leaves out details that materially change the implementation (scale, who uses it, how it fails).

## Process

1. **Identify the actual goal**, not just the literal request — a stated request is sometimes a proxy for a broader need; understanding the real goal can surface a simpler or more robust solution than the literally-requested one.
2. **List 2-3 genuinely different approaches**, not one approach and two straw men — each with its real trade-off (simplicity vs. flexibility, effort vs. completeness).
3. **Ask targeted clarifying questions** only for genuinely undecidable points (i.e. points where the two approaches diverge and the requester's answer determines which is right) — not a long generic questionnaire.
4. **Recommend one approach with the reasoning**, rather than presenting an exhaustive menu and asking the requester to design it themselves.

## What this is not

Not a substitute for research — investigate the existing codebase for how similar problems were already solved before presenting options; a brainstorm grounded only in general knowledge and not the actual repo produces options that don't fit.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'dispatching-parallel-subagents',
    description:
      'Splits an investigation or task into independent pieces that can run concurrently via sub-agents, instead of serially exploring a large codebase turn by turn. Use when a task has two or more genuinely independent research/verification threads — e.g. checking multiple unrelated files, systems, or hypotheses.',
    body: `# Dispatching parallel sub-agents

## When parallelization actually helps

Only when the sub-tasks are genuinely independent — neither needs the other's result to proceed. Examples: researching two unrelated parts of a large codebase before a combined plan; verifying a fix against several unrelated test suites; investigating two independent hypotheses for a bug's cause.

## When it doesn't help

Sequential-by-nature work (step 2 needs step 1's output) gains nothing from parallelizing and adds coordination overhead. Don't parallelize just because a task has multiple steps — parallelize only independent ones.

## Pattern

1. Decompose the task into pieces with no data dependency between them.
2. Dispatch each piece with enough self-contained context that the sub-agent doesn't need to ask follow-up questions — it starts cold, with no memory of the parent conversation.
3. Synthesize the results yourself once they return — don't just concatenate sub-agent outputs; reconcile them into one coherent answer/plan.

## Cost awareness

Each sub-agent re-derives context from scratch, which has a real cost. Reserve this for cases where the parallelism genuinely saves wall-clock time or context budget over doing the same research serially — not for tasks a single pass could handle directly.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'building-mcp-servers',
    description:
      'Correct shape for a new MCP (Model Context Protocol) server: one responsibility per tool, precise input schemas, and clear error surfaces instead of silent failures. Use when asked to build or extend an MCP server or its tool definitions.',
    body: `# Building MCP servers

## Tool design

- **One responsibility per tool.** A tool that does "manage the resource" (create, read, update, delete all behind one input shape) is harder for a model to call correctly than four small, precisely-named tools.
- **Precise input schemas.** Use \`required\`, specific types, and per-field descriptions that state constraints (format, valid range, what happens with an empty value) — an ambiguous schema produces ambiguous calls.
- **Descriptions written for tool selection, not documentation.** The tool description is what a model sees when deciding *whether* to call it — lead with what it does and when to use it, the same discipline as this codebase's own Agent Skills descriptions.

## Error handling

- Return a clear, structured error message on failure — never fail silently or return an empty/default result that looks like success.
- Distinguish "the call was malformed" (bad input — tell the caller what was wrong) from "the operation failed for an external reason" (e.g. the underlying API is down) — different failure classes call for different model behavior on retry.

## Read vs. write tools

Mirror the read/write split already used in this codebase's own tool surface (\`READ_ONLY_TOOL_NAMES\`, approval-gating for writes in \`approvals.ts\`): a new write-capable MCP tool should default to requiring confirmation before executing, not auto-run.

## Testing

Test the server's tools directly (call each with valid and invalid input) before wiring it into an agent loop — verifying tool behavior in isolation is far faster to debug than debugging it through a live agent session.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'frontend-design-quality-bar',
    description:
      'Concrete checks against generic "AI-slop" UI: a consistent spacing scale, real contrast ratios, an intentional type scale, and avoiding default-everything layouts. Use when building or reviewing a new UI screen/component, before calling it visually done.',
    body: `# Frontend design quality bar

## Spacing
Use a consistent spacing scale (e.g. 4/8/12/16/24/32px, or a framework's default scale like Tailwind's) rather than arbitrary pixel values scattered throughout — inconsistent spacing is one of the fastest visual tells of an unpolished UI.

## Contrast
Body text should meet at least WCAG AA contrast (4.5:1 for normal text) against its background — check this explicitly for any custom color pairing, not just assume it's fine. Low-contrast gray-on-white/gray-on-gray text is a common generic-AI-UI smell.

## Type scale
Pick a small, deliberate set of font sizes/weights for a clear hierarchy (e.g. one size for page titles, one for section headers, one for body) rather than every text element sized individually — an intentional hierarchy reads as designed, not defaulted.

## Avoid default-everything layouts
A page that's just stacked full-width cards with no visual hierarchy, no grouping, and generic rounded-corner boxes everywhere reads as templated. Vary emphasis deliberately: what's the one thing on this screen that should draw the eye first?

## Interactive states
Every clickable element needs a visible hover/focus/active state — missing these is invisible in a static screenshot but immediately reads as unfinished/broken in actual use.

## Verify visually
Static code review of JSX/CSS doesn't catch layout bugs (overlap, overflow, broken responsive behavior) — use \`webapp-testing-with-playwright\` or an actual browser check before calling a UI change done, per \`verification-before-completion\`.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'defensive-api-error-handling',
    description:
      'Correct handling of external API calls: distinguishing retryable (5xx, timeout, network) from non-retryable (4xx) failures, exponential backoff with a cap, and never blindly retrying non-idempotent writes. Use when integrating any external HTTP API or SDK call.',
    body: `# Defensive API error handling

## Classify the failure before deciding to retry

- **Retryable**: network errors, timeouts, 429 (rate limit, respect \`Retry-After\` if present), 5xx server errors — these are often transient.
- **Non-retryable**: 4xx client errors other than 429 (400, 401, 403, 404, 422) — the request itself is wrong; retrying identically will fail identically. Surface the error instead of looping on it.

## Backoff

Use exponential backoff with jitter and a capped max delay/attempt count, not a fixed retry interval or unbounded retries:

\`\`\`ts
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxAttempts || !isRetryable(err)) throw err;
      const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000) * (0.5 + Math.random() * 0.5);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
\`\`\`

## Idempotency matters for retries

Retrying a GET or a query is safe. Retrying a POST that creates a resource (a payment, an entry) without an idempotency key can double-create it — only retry non-idempotent writes if the API supports an idempotency key/token, or the operation is verified safe to repeat (e.g. this codebase's \`shared_skills\` upsert on \`(owner_id, name)\`, where a retry just re-applies the same state).

## Surface the real error

Don't swallow the underlying error into a generic "something went wrong" — preserve enough detail (status code, response body) for the caller/log to actually diagnose the failure, while still following \`security-checklist-for-new-code\`'s rule against logging secrets.
`,
    origin: 'walkcroach:builtin',
  },
  {
    name: 'safe-dependency-upgrades',
    description:
      'Process for bumping a dependency version safely: read the changelog/release notes for breaking changes first, upgrade one dependency at a time, and run the full test suite before moving to the next. Use when asked to update packages, or when a build breaks after a lockfile/dependency change.',
    body: `# Safe dependency upgrades

## Before upgrading

1. Check the target package's changelog/release notes between the current and target version for breaking changes — especially for a major version bump (semver major = breaking changes are expected, not exceptional).
2. Note any migration steps called out (renamed APIs, changed defaults, new required config) so they can be applied deliberately rather than discovered via failing tests.

## Upgrade process

1. Upgrade **one dependency at a time** (or one tightly-coupled group, e.g. a framework + its official plugin) rather than bulk-upgrading everything at once — isolates which specific upgrade caused a failure if one occurs.
2. Run the full build + test suite after each individual upgrade, not just at the end of a batch.
3. If a test fails, determine whether it's (a) a real behavior change requiring a code update, or (b) the test asserting on now-outdated implementation details — fix accordingly, don't just delete or loosen a failing assertion to make it pass.

## Lockfile discipline

Commit the updated lockfile alongside the \`package.json\` change in the same commit — an upgraded manifest with a stale lockfile means different developers/CI can silently resolve different actual versions.

## Security-motivated upgrades

For an upgrade driven by a security advisory, confirm the fixed version actually contains the fix (check the advisory's "patched versions" field) rather than just bumping to "latest" and assuming.
`,
    origin: 'walkcroach:builtin',
  },
];

/** In-bundle set: WalkCroach companion + coding skills (Cockroach official loads from JSON). */
export const BUNDLED_SKILLS: BundledSkill[] = [
  ...WALKCROACH_COMPANION_SKILLS,
  ...WALKCROACH_CODING_SKILLS,
];
