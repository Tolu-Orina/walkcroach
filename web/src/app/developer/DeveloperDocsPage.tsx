import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSdkApiBaseUrl, listProjects } from '../../api/client';
import { CodeBlock } from './CodeBlock';

const OPENAPI_PATHS = [
  ['GET', '/sdk-health', 'Liveness, capabilities, retention window'],
  ['POST', '/keys', 'Mint API key (Cognito; plaintext once)'],
  ['GET', '/keys', 'List keys'],
  ['DELETE', '/keys/{id}', 'Revoke key'],
  ['GET', '/keys/usage', 'Per-key + by-action usage (SKU A)'],
  ['POST', '/memory/entries', 'Remember'],
  ['GET', '/memory/entries', 'List'],
  ['POST', '/memory/recall', 'Semantic recall'],
  ['POST', '/memory/diff', 'asOf / diff'],
  ['POST', '/memory/erase', 'Audited erase'],
  ['POST', '/content/publish', 'Content publish run'],
] as const;

/**
 * Developer portal Docs (dual-funnel P2).
 * Stranger-complete: quickstart, OpenAPI, MCP hosts, security, FAQ.
 */
export function DeveloperDocsPage() {
  const base = getSdkApiBaseUrl();
  const [projectId, setProjectId] = useState<string>('YOUR_PROJECT_ID');

  useEffect(() => {
    let cancelled = false;
    void listProjects()
      .then((projects) => {
        if (cancelled) return;
        const first = projects.find((p) => !p.name?.startsWith('__')) ?? projects[0];
        if (first?.id) setProjectId(first.id);
      })
      .catch(() => {
        /* keep placeholder */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const install = `npm install @walkcroach/sdk`;

  const quickstart = `import { WalkCroach, formatHitsForPrompt } from '@walkcroach/sdk';

const wc = new WalkCroach({
  apiKey: process.env.WALKCROACH_API_KEY, // wc_live_… — server-side only
  baseUrl: '${base}',
});

// Optional: skip copying a UUID — ensures __walkcroach_sdk__ for this key
const { id: projectId } = await wc.projects.ensure();
// Or use a project from WalkCroach Web: '${projectId}'

await wc.memory.remember({
  projectId,
  kind: 'decision',
  text: 'Chose Drizzle over Prisma for edge runtimes',
  surface: 'my-agent',
});

const hits = await wc.memory.recall({
  projectId,
  query: 'which ORM did we pick?',
});

const memoryBlock = formatHitsForPrompt(hits, { budget: { maxHits: 5 } });`;

  const eraseSnippet = `await wc.memory.erase({
  projectId,
  reason: 'user requested deletion of outdated preference',
  entryIds: ['ENTRY_UUID'], // omit to erase all current entries in the project
  exportFirst: true,        // optional bundle returned before tombstone
});`;

  const pythonStub = `# Python SDK not published yet — HTTP against the OpenAPI base.
# Example (httpx): POST {base}/v1/memory/recall with Authorization: Bearer wc_live_…
import os, httpx
base = os.environ.get("WALKCROACH_BASE_URL", "${base}")
key = os.environ["WALKCROACH_API_KEY"]
r = httpx.get(f"{base}/v1/sdk-health")
print(r.status_code, r.json())`;

  const mcpServe = `# Terminal A — local MCP HTTP (loopback only; holds your API key)
export WALKCROACH_API_KEY=wc_live_…
export WALKCROACH_BASE_URL=${base}
npx -y @walkcroach/sdk-mcp serve --port 7801`;

  const mcpClaude = `# Claude Code (HTTP transport; stdio is not supported)
claude mcp add --transport http walkcroach http://127.0.0.1:7801/mcp`;

  const mcpCursor = `// Cursor / VS Code mcp.json (HTTP)
{
  "mcpServers": {
    "walkcroach": {
      "url": "http://127.0.0.1:7801/mcp"
    }
  }
}`;

  const mcpCodex = `# OpenAI Codex / compatible MCP HTTP hosts
# Point the host at the loopback server from Terminal A:
#   URL: http://127.0.0.1:7801/mcp
# Keep WALKCROACH_API_KEY only on the serve process — never in the IDE UI.`;

  return (
    <div className="space-y-4">
      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          5-minute quickstart
        </h2>
        <p className="text-[12px] leading-relaxed text-mist">
          This portal is the <strong className="font-medium text-paper">memory platform</strong>{' '}
          product — durable recall via <code className="font-mono text-paper">@walkcroach/sdk</code>{' '}
          and MCP. It is not a hosted coding agent (that lives in the IDE Extension, CLI, and
          Desktop IDE).
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-[12px] leading-relaxed text-mist">
          <li>
            Mint a key on{' '}
            <Link to="/app/developer/keys" className="text-signal hover:underline">
              API keys
            </Link>{' '}
            with at least <code className="font-mono text-paper">memory:write</code> (and{' '}
            <code className="font-mono text-paper">memory:read</code> to recall).
          </li>
          <li>
            Set <code className="font-mono text-paper">WALKCROACH_API_KEY</code> in a{' '}
            <strong className="font-medium text-paper">server</strong> process — never in a
            browser bundle.
          </li>
          <li>
            Run the snippet below. <code className="font-mono text-paper">projects.ensure()</code>{' '}
            creates <code className="font-mono text-paper">__walkcroach_sdk__</code> if you do not
            already have a project id.
          </li>
          <li>
            Confirm health:{' '}
            <code className="font-mono text-paper">{base}/v1/sdk-health</code>
          </li>
        </ol>
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          1. Install
        </h2>
        <CodeBlock>{install}</CodeBlock>
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          2. Remember & recall
        </h2>
        <p className="text-[12px] leading-relaxed text-mist">
          Every memory call requires a{' '}
          <code className="font-mono text-paper">projectId</code> so the vector index stays
          prefix-scoped.
          {projectId !== 'YOUR_PROJECT_ID' && (
            <>
              {' '}
              Your first Web project is{' '}
              <code className="font-mono text-paper">{projectId}</code> (optional —{' '}
              <code className="font-mono text-paper">ensure()</code> works without it).
            </>
          )}
        </p>
        <CodeBlock>{quickstart}</CodeBlock>
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          3. Retention & erase
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-[12px] leading-relaxed text-mist">
          <li>
            <strong className="font-medium text-paper">asOf / time-travel</strong> is bounded by
            CockroachDB MVCC on <code className="font-mono text-paper">memory_entries</code>{' '}
            (~25 hours). Older instants return a retention error — see Ops → asOf retention and
            ADR-0001.
          </li>
          <li>
            <strong className="font-medium text-paper">Long-lived governance</strong> uses{' '}
            <code className="font-mono text-paper">memory.audit()</code> and erase tombstones, not
            multi-year asOf (ADR-0002).
          </li>
          <li>
            <strong className="font-medium text-paper">Erase</strong> requires{' '}
            <code className="font-mono text-paper">memory:write</code>, is audited, and meters 1
            credit. Prefer <code className="font-mono text-paper">exportFirst: true</code> when you
            need a portable copy before tombstone.
          </li>
        </ul>
        <CodeBlock>{eraseSnippet}</CodeBlock>
        <p className="text-[12px] text-mist">
          Policy checklist:{' '}
          <Link to="/app/developer/governance" className="text-signal hover:underline">
            Governance
          </Link>
          . Live retention window:{' '}
          <Link to="/app/developer/ops" className="text-signal hover:underline">
            Ops
          </Link>
          .
        </p>
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          4. OpenAPI
        </h2>
        <p className="text-[12px] leading-relaxed text-mist">
          Machine-readable contract for{' '}
          <code className="font-mono text-paper">@walkcroach/sdk</code>. Same file the package
          ships under <code className="font-mono text-paper">openapi/v1.yaml</code>.
        </p>
        <p className="text-[12px]">
          <a
            href="/openapi/v1.yaml"
            className="text-signal hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Open / download v1.yaml
          </a>
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-[12px]">
            <thead>
              <tr className="border-b border-line text-mist">
                <th className="py-1.5 pr-3 font-medium">Method</th>
                <th className="py-1.5 pr-3 font-medium">Path</th>
                <th className="py-1.5 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody>
              {OPENAPI_PATHS.map(([method, path, summary]) => (
                <tr key={`${method}-${path}`} className="border-b border-line/60">
                  <td className="py-1.5 pr-3 font-mono text-mist">{method}</td>
                  <td className="py-1.5 pr-3 font-mono text-paper">{path}</td>
                  <td className="py-1.5 text-mist">{summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-mist">
          On the shared gateway the stage is already named <code className="font-mono">v1</code>;
          public URLs look like{' '}
          <code className="font-mono text-paper">…/v1/sdk-health</code>.
        </p>
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          5. MCP (Claude · Cursor · Codex)
        </h2>
        <p className="text-[12px] leading-relaxed text-mist">
          <code className="font-mono text-paper">@walkcroach/sdk-mcp</code> exposes{' '}
          <strong className="font-medium text-paper">memory tools only</strong> (recall, remember,
          list, timeline). Content publish / runs are not on MCP — use{' '}
          <code className="font-mono text-paper">@walkcroach/sdk</code> for those. Streamable HTTP on
          loopback; stdio is unsupported.
        </p>
        <CodeBlock>{mcpServe}</CodeBlock>
        <CodeBlock>{mcpClaude}</CodeBlock>
        <CodeBlock>{mcpCursor}</CodeBlock>
        <CodeBlock>{mcpCodex}</CodeBlock>
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          6. Python (HTTP stub)
        </h2>
        <p className="text-[12px] leading-relaxed text-mist">
          No first-party Python package yet. Call the same OpenAPI paths with your key.
        </p>
        <CodeBlock>{pythonStub}</CodeBlock>
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Security & limits
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-[12px] leading-relaxed text-mist">
          <li>
            Never ship <code className="font-mono text-paper">wc_live_…</code> keys to browsers or
            mobile apps. The TypeScript SDK refuses browser apiKey use unless you set{' '}
            <code className="font-mono text-paper">allowBrowserApiKey: true</code> (trusted
            non-page runtimes only). Prefer access tokens for user-context calls.
          </li>
          <li>
            API keys cannot mint or revoke other keys — lifecycle stays behind interactive sign-in
            (this portal).
          </li>
          <li>
            Successful meterable calls return{' '}
            <code className="font-mono text-paper">x-ratelimit-remaining</code> /{' '}
            <code className="font-mono text-paper">x-ratelimit-limit</code> (monthly credit pool) and{' '}
            <code className="font-mono text-paper">x-credits-cost</code>. Exhaustion is{' '}
            <code className="font-mono text-paper">QuotaError</code> / HTTP{' '}
            <code className="font-mono text-paper">429</code> with{' '}
            <code className="font-mono text-paper">Retry-After</code>. Manage plan under{' '}
            <Link to="/app/settings" className="text-signal hover:underline">
              Settings → Billing
            </Link>
            .
          </li>
          <li>
            <code className="font-mono text-paper">remember</code> is synchronous by design
            (correctness over fire-and-forget).
          </li>
        </ul>
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Support FAQ
        </h2>
        <dl className="space-y-3 text-[12px] leading-relaxed text-mist">
          <div>
            <dt className="font-medium text-paper">I closed the page before copying the key</dt>
            <dd className="mt-0.5">
              Plaintext is shown once. Revoke the key on{' '}
              <Link to="/app/developer/keys" className="text-signal hover:underline">
                API keys
              </Link>{' '}
              and create a new one.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-paper">403 missing scope</dt>
            <dd className="mt-0.5">
              Mint a key that includes the needed scope (
              <code className="font-mono text-paper">memory:read</code>,{' '}
              <code className="font-mono text-paper">memory:write</code>, or{' '}
              <code className="font-mono text-paper">content:run</code>).
            </dd>
          </div>
          <div>
            <dt className="font-medium text-paper">429 QuotaError</dt>
            <dd className="mt-0.5">
              Shared monthly credits are exhausted. Honour{' '}
              <code className="font-mono text-paper">Retry-After</code>, check{' '}
              <Link to="/app/developer/ops" className="text-signal hover:underline">
                Ops
              </Link>
              , then{' '}
              <Link to="/app/settings" className="text-signal hover:underline">
                upgrade / billing
              </Link>
              .
            </dd>
          </div>
          <div>
            <dt className="font-medium text-paper">asOf failed with retention error</dt>
            <dd className="mt-0.5">
              Point-in-time recall is limited to the MVCC window (~25h). Use export/audit for
              longer provenance — not multi-year asOf.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-paper">Status / incidents</dt>
            <dd className="mt-0.5">
              Check{' '}
              <Link to="/app/developer/ops" className="text-signal hover:underline">
                Ops → sdk-health
              </Link>
              . Production alarms live in CloudWatch namespace{' '}
              <code className="font-mono text-paper">WalkCroach/Memory</code>. Email support via
              your WalkCroach account contact if health stays down after refresh.
            </dd>
          </div>
        </dl>
      </section>

      <section className="surface space-y-2 p-5 text-[12px] text-mist">
        <p className="font-semibold text-paper">Endpoint base</p>
        <p className="font-mono text-paper">{base}</p>
        <p className="pt-1">
          SDK health:{' '}
          <code className="font-mono text-paper">{base}/v1/sdk-health</code>
        </p>
      </section>
    </div>
  );
}
