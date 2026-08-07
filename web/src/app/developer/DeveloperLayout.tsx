import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/app/developer', label: 'Overview', end: true },
  { to: '/app/developer/keys', label: 'API keys' },
  { to: '/app/developer/ops', label: 'Ops' },
  { to: '/app/developer/governance', label: 'Governance' },
  { to: '/app/developer/docs', label: 'Docs' },
] as const;

/**
 * Developer portal shell — API keys, SDK docs, usage pointers.
 * Sits under EcosystemShell like Settings.
 */
export function DeveloperLayout() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
        <p className="eyebrow">Platform</p>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-paper">
          Developer
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-mist">
          Mint API keys and call the same CockroachDB memory layer your Web,
          Browser Extension, IDE, and CLI already share — via{' '}
          <code className="font-mono text-[12px] text-paper">@walkcroach/sdk</code>
          .
        </p>

        <nav
          className="mt-8 flex flex-wrap gap-1 border-b border-line pb-px"
          aria-label="Developer sections"
        >
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={'end' in tab ? tab.end : false}
              className={({ isActive }) =>
                `interactive relative -mb-px rounded-t-[var(--radius-control)] px-3.5 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'border border-b-ink bg-panel/80 text-paper backdrop-blur-md'
                    : 'border border-transparent text-mist hover:text-paper'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <div className="pt-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
