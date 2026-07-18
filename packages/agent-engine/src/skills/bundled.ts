/**
 * Bundled CockroachDB Agent Skills (progressive disclosure).
 * Open Agent Skills format; portable (NFR-D13). Condensed from CockroachDB guidance.
 */

export type BundledSkill = {
  name: string;
  description: string;
  body: string;
};

export const BUNDLED_SKILLS: BundledSkill[] = [
  {
    name: 'cockroachdb-schema-design',
    description:
      'Design CockroachDB tables, primary keys, and interleaving-aware schemas. Use when creating tables, modeling entities, or choosing primary keys.',
    body: `# CockroachDB schema design

## Principles
- Prefer UUID or unordered unique keys carefully; hot ranges from sequential INT PKs are a common pitfall.
- Put the most selective equality filter columns early in composite primary keys when access patterns are known.
- Use \`STRING\` / \`INT\` / \`TIMESTAMPTZ\` / \`UUID\` / \`JSONB\` deliberately; avoid unbounded family growth.
- Secondary indexes: create only for proven query paths; prefer covering indexes for hot reads.
- Multi-region: consider \`REGIONAL BY ROW\` / locality only when the product needs it — do not add complexity by default.

## Workflow
1. Ask for the top 3 query patterns.
2. Propose DDL as a reviewable statement (never apply without approval).
3. Note secondary indexes separately from the base table.
4. Call out any sequential-key or chatty-transaction risks.

## Safety
- Prefer additive migrations.
- Never suggest \`DROP TABLE\` / \`DROP DATABASE\` unless the user explicitly requested destruction.
`,
  },
  {
    name: 'cockroachdb-indexes-and-queries',
    description:
      'Index design and query optimization for CockroachDB (EXPLAIN, covering indexes, anti-patterns). Use when adding indexes or tuning slow SQL.',
    body: `# CockroachDB indexes and queries

## Index design
- Create indexes that match \`WHERE\` + \`ORDER BY\` + join keys.
- Prefer partial indexes when predicates are selective and stable.
- Avoid redundant indexes that duplicate the PK prefix without benefit.

## Query workflow
1. Inspect schema (\`get_table_schema\` / MCP).
2. Run \`EXPLAIN\` / \`EXPLAIN ANALYZE\` on the candidate query when possible.
3. Propose the smallest index or rewrite that addresses the bottleneck.
4. Verify write amplification cost before recommending many secondary indexes.

## Anti-patterns
- \`SELECT *\` over wide rows in hot paths.
- Full table scans on large tables without pagination.
- Transactions that touch many ranges unnecessarily.
`,
  },
  {
    name: 'cockroachdb-operations',
    description:
      'CockroachDB Cloud operations via ccloud CLI: clusters, backups, networking. Use for provisioning or lifecycle changes — always behind explicit approval.',
    body: `# CockroachDB Cloud operations (ccloud)

## Tool choice
- Interactive schema/data exploration → Managed MCP (read-only by default).
- Provisioning, networking, backups, cluster lifecycle → \`ccloud\` with \`-o json\`.

## Rules
- Always show the exact \`ccloud\` args and wait for explicit user confirmation.
- Use least-privilege project-scoped service accounts — never org-wide keys in demos.
- Prefer preview / non-prod clusters for experiments.
- After create/update, parse JSON output and summarize IDs/status to the user.

## Never
- Auto-approve any ccloud infra action.
- Run destructive delete without the user typing an explicit destroy intent in the task.
`,
  },
];
