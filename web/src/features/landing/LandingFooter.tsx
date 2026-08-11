import { Link } from 'react-router-dom';

const FOOTER_LINKS = [
  { href: '/app/chat', label: 'Chat' },
  { href: '/app/apps', label: 'Apps' },
  { href: '/app/developer', label: 'Developer' },
  { href: '/signin', label: 'Sign in' },
  { href: '/privacy.html', label: 'Privacy', external: true },
] as const;

export function LandingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-white/10 bg-[var(--lp-footer)] text-[var(--lp-ink)]">
      <div className="grid gap-10 px-3 py-14 sm:px-4 lg:grid-cols-[1.4fr_1fr] lg:px-5 lg:py-16">
        <div>
          <div className="flex items-center gap-1">
            <img
              src="/walkcroach-icon.png"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 rounded-[var(--lp-radius-control)] object-cover"
            />
            <span className="font-display text-lg font-extrabold tracking-tight text-white">
              WalkCroach
            </span>
          </div>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-[var(--lp-footer-muted)]">
            One memory layer across six surfaces — and coding agents that
            amplify how you work, not replace your tools.
          </p>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--lp-footer-muted)]">
            Product
          </p>
          <nav
            className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold"
            aria-label="Footer"
          >
            {FOOTER_LINKS.map((link) =>
              'external' in link && link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  className="interactive text-white/90 hover:text-white"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  to={link.href}
                  className="interactive text-white/90 hover:text-white"
                >
                  {link.label}
                </Link>
              ),
            )}
          </nav>
        </div>
      </div>

      <div className="border-t border-white/10 px-3 py-5 sm:px-4 lg:px-5">
        <div className="flex flex-col gap-2 text-xs text-[var(--lp-footer-muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} WalkCroach</p>
          <p>Built by Rinegan Solutions Limited</p>
        </div>
      </div>
    </footer>
  );
}
