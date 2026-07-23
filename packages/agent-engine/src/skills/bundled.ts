/**
 * Bundled Agent Skills registry seed.
 * Official CockroachDB skills are codegenerated from cockroachlabs/cockroachdb-skills.
 * One WalkCroach-specific companion skill covers MCP vs ccloud tool routing.
 */

import { COCKROACHDB_OFFICIAL_SKILLS } from './cockroachdb-official.generated.js';

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

/** Default bundled set: official CockroachDB skills + WalkCroach companion. */
export const BUNDLED_SKILLS: BundledSkill[] = [
  ...COCKROACHDB_OFFICIAL_SKILLS,
  ...WALKCROACH_COMPANION_SKILLS,
];
