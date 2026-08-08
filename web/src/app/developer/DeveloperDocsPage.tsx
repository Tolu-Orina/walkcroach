import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSdkApiBaseUrl, listProjects } from '../../api/client';

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-[var(--radius-control)] border border-line bg-ink/50 p-3.5 font-mono text-[12px] leading-relaxed text-paper">
      <code>{children}</code>
    </pre>
  );
}

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

// Inject into your system prompt (budget helpers included)
const memoryBlock = formatHitsForPrompt(hits, { budget: { maxHits: 5 } });`;

  const eraseSnippet = `await wc.memory.erase({
  projectId,
  reason: 'user requested deletion of outdated preference',
  entryIds: ['ENTRY_UUID'], // omit to erase all current entries in the project
  exportFirst: true,        // optional bundle returned before tombstone
});`;

  const mcpServe = `# Terminal A — local MCP HTTP (loopback only; holds your API key)
export WALKCROACH_API_KEY=wc_live_…
export WALKCROACH_BASE_URL=${base}
npx -y @walkcroach/sdk-mcp serve --port 7801

# Terminal B — Claude Code (HTTP transport; stdio is not supported)
claude mcp add --transport http walkcroach http://127.0.0.1:7801/mcp`;

  const mcpCursor = `// Cursor / VS Code mcp.json (HTTP)
{
  "mcpServers": {
    "walkcroach": {
      "url": "http://127.0.0.1:7801/mcp"
    }
  }
}`;

  return (
    <div className="space-y-4">
      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          5-minute quickstart
        </h2>
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
          4. MCP (optional)
        </h2>
        <p className="text-[12px] leading-relaxed text-mist">
          <code className="font-mono text-paper">@walkcroach/sdk-mcp</code> exposes{' '}
          <strong className="font-medium text-paper">memory tools only</strong> (recall, remember,
          list, timeline). Content publish / runs are not on MCP — use{' '}
          <code className="font-mono text-paper">@walkcroach/sdk</code> for those. Streamable HTTP on
          loopback; stdio is unsupported.
        </p>
        <CodeBlock>{mcpServe}</CodeBlock>
        <CodeBlock>{mcpCursor}</CodeBlock>
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Security & limits
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-[12px] leading-relaxed text-mist">
          <li>
            Never ship <code className="font-mono text-paper">wc_live_…</code> keys to browsers or
            mobile apps. Use an access token for user-context calls.
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
            <code className="font-mono text-paper">QuotaError</code> with{' '}
            <code className="font-mono text-paper">Retry-After</code>. Manage plan under{' '}
            <Link to="/app/settings" className="text-signal hover:underline">
              Settings → Billing
            </Link>
            .
          </li>
          <li>
            <code className="font-mono text-paper">remember</code> is synchronous by design
            (correctness over fire-and-forget). If p95 write latency hurts a hot path, buffer
            client-side and flush — do not drop the await without an outbox you control.
          </li>
        </ul>
      </section>

      <section className="surface space-y-2 p-5 text-[12px] text-mist">
        <p className="font-semibold text-paper">Endpoint base</p>
        <p className="font-mono text-paper">{base}</p>
        <p className="pt-1">
          SDK health:{' '}
          <code className="font-mono text-paper">{base}/v1/sdk-health</code>
          {' '}
          (ide-local also aliases <code className="font-mono text-paper">/v1/health</code>; on the
          shared gateway, bare <code className="font-mono text-paper">/health</code> is the agent
          smoke endpoint)
        </p>
      </section>
    </div>
  );
}
