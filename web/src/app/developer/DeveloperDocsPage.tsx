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
        if (!cancelled && projects[0]?.id) {
          setProjectId(projects[0].id);
        }
      })
      .catch(() => {
        /* keep placeholder */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const install = `npm install @walkcroach/sdk`;

  const quickstart = `import { WalkCroach } from '@walkcroach/sdk';

const wc = new WalkCroach({
  apiKey: process.env.WALKCROACH_API_KEY,
  baseUrl: '${base}',
});

await wc.memory.remember({
  projectId: '${projectId}',
  kind: 'decision',
  text: 'Chose Drizzle over Prisma for edge runtimes',
  surface: 'my-agent',
});

const hits = await wc.memory.recall({
  projectId: '${projectId}',
  query: 'which ORM did we pick?',
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
          1. Install
        </h2>
        <CodeBlock>{install}</CodeBlock>
        <p className="text-[12px] text-mist">
          Create a key on the{' '}
          <Link to="/app/developer/keys" className="text-signal hover:underline">
            API keys
          </Link>{' '}
          tab, then set{' '}
          <code className="font-mono text-paper">WALKCROACH_API_KEY</code>.
        </p>
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          2. Remember & recall
        </h2>
        <p className="text-[12px] leading-relaxed text-mist">
          Every call requires a{' '}
          <code className="font-mono text-paper">projectId</code> so the vector
          index stays prefix-scoped. Example uses{' '}
          {projectId === 'YOUR_PROJECT_ID' ? (
            'a placeholder — create a project first'
          ) : (
            <>
              your project{' '}
              <code className="font-mono text-paper">{projectId}</code>
            </>
          )}
          .
        </p>
        <CodeBlock>{quickstart}</CodeBlock>
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          3. MCP (optional)
        </h2>
        <p className="text-[12px] leading-relaxed text-mist">
          <code className="font-mono text-paper">@walkcroach/sdk-mcp</code> speaks
          Streamable HTTP on loopback (stdio is deliberately unsupported). Start
          the server, then point Claude Code or Cursor at the URL.
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
            Never ship <code className="font-mono text-paper">wc_live_…</code> keys
            to browsers or mobile apps. Use an access token for user-context calls.
          </li>
          <li>
            API keys cannot mint or revoke other keys — lifecycle stays behind
            interactive sign-in (this portal).
          </li>
          <li>
            Time-travel (<code className="font-mono text-paper">asOf</code>) is
            bounded by CockroachDB MVCC retention on{' '}
            <code className="font-mono text-paper">memory_entries</code> (about 25
            hours). Long-lived governance uses{' '}
            <code className="font-mono text-paper">memory_audit</code> and erase
            tombstones (not multi-year asOf) — see ADR-0001.
          </li>
          <li>
            Quota / plan limits return{' '}
            <code className="font-mono text-paper">QuotaError</code> with{' '}
            <code className="font-mono text-paper">Retry-After</code> when enforced.
            Manage plan under{' '}
            <Link to="/app/settings" className="text-signal hover:underline">
              Settings → Billing
            </Link>
            .
          </li>
        </ul>
      </section>

      <section className="surface space-y-2 p-5 text-[12px] text-mist">
        <p className="font-semibold text-paper">Endpoint base</p>
        <p className="font-mono text-paper">{base}</p>
        <p className="pt-1">
          SDK health:{' '}
          <code className="font-mono text-paper">{base}/v1/sdk-health</code>
          {' '}(ide-local also aliases{' '}
          <code className="font-mono text-paper">/v1/health</code>; on the shared
          gateway, bare <code className="font-mono text-paper">/health</code> is
          the agent smoke endpoint)
        </p>
      </section>
    </div>
  );
}
