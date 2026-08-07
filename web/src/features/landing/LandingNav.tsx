import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { LandingThemeToggle } from './LandingThemeToggle';

const NAV_LINKS = [
  { href: '#surfaces-web', label: 'Web' },
  { href: '#surfaces-extension', label: 'Extension' },
  { href: '#surfaces-ide', label: 'IDE Ext' },
  { href: '#surfaces-cli', label: 'CLI' },
  { href: '#surfaces-desktop', label: 'Desktop IDE' },
  { href: '#surfaces-sdk', label: 'SDK' },
] as const;

type Props = {
  showGuest?: boolean;
  authenticated?: boolean;
};

export function LandingNav({ showGuest = false, authenticated = false }: Props) {
  return (
    <header className="lp-nav">
      <div className="flex w-full items-center gap-4 px-3 py-3.5 sm:px-4 lg:px-5">
        <Link
          to="/"
          className="interactive flex shrink-0 items-center gap-1"
          aria-label="WalkCroach home"
        >
          <img
            src="/walkcroach-icon.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-[var(--lp-radius-control)] object-cover"
          />
          <span className="font-display text-base font-extrabold tracking-tight text-[var(--lp-ink)]">
            WalkCroach
          </span>
        </Link>

        <nav
          className="hidden min-w-0 flex-1 items-center justify-center gap-1 md:flex lg:gap-2"
          aria-label="Surfaces"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={clsx(
                'interactive rounded-[var(--lp-radius-control)] px-2.5 py-2',
                'font-sans text-sm font-extrabold text-[var(--lp-ink)]',
                'transition hover:bg-[var(--lp-accent-soft)] hover:text-[var(--lp-accent)]',
              )}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <LandingThemeToggle />
          {authenticated ? (
            <Link to="/app/chat" className="lp-btn-primary">
              Open Chat
            </Link>
          ) : (
            <>
              <Link to="/signup" className="lp-btn-primary">
                Start building
              </Link>
              {showGuest && (
                <Link to="/try" className="lp-btn-secondary">
                  Try guest
                </Link>
              )}
            </>
          )}
        </div>
      </div>
      <nav
        className="flex gap-1 overflow-x-auto border-t border-[var(--lp-line)] px-3 py-2 sm:px-4 md:hidden"
        aria-label="Surfaces"
      >
        {NAV_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="interactive shrink-0 rounded-[var(--lp-radius-control)] px-3 py-2 font-sans text-sm font-extrabold text-[var(--lp-ink)]"
          >
            {link.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
