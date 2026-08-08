import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { BrandLogo } from './BrandLogo';
import { ThemeToggle } from './ThemeToggle';

type AppShellProps = {
  children: ReactNode;
  wide?: boolean;
  minimal?: boolean;
  marketing?: boolean;
};

function NavItem({
  to,
  children,
  end,
}: {
  to: string;
  children: ReactNode;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `interactive rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium transition ${
          isActive
            ? 'bg-panel text-paper'
            : 'text-mist hover:bg-panel/70 hover:text-paper'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

export function AppShell({
  children,
  wide = false,
  minimal = false,
  marketing = false,
}: AppShellProps) {
  const { status, signOut, cognitoEnabled, devAuthAllowed, user } = useAuth();
  const location = useLocation();
  const onBuilder =
    location.pathname.startsWith('/project/') ||
    location.pathname.includes('/builder') ||
    location.pathname === '/try';

  return (
    <div className="relative z-0 flex h-full min-h-0 flex-col">
      <header
        className={`shrink-0 ${
          marketing
            ? 'border-b border-white/10 bg-ink/35 backdrop-blur-xl'
            : 'border-b border-line/80 bg-ink/55 backdrop-blur-xl'
        }`}
      >
        <div
          className={`flex w-full items-center justify-between gap-4 py-3.5 ${
            marketing ? 'px-4 sm:px-5' : 'px-5 sm:px-6'
          } ${wide || marketing ? '' : 'mx-auto max-w-6xl'}`}
        >
          <BrandLogo to="/" showWordmark={!marketing} />

          {!minimal && (
            <nav
              className="flex flex-1 items-center justify-end gap-1 sm:gap-1.5"
              aria-label="Main"
            >
              {status === 'authenticated' && (
                <>
                  <NavItem to="/app/chat" end>
                    Chat
                  </NavItem>
                  <NavItem to="/app/projects">Projects</NavItem>
                  {onBuilder && (
                    <span className="hidden px-2 font-mono text-[10px] uppercase tracking-wider text-mist/70 sm:inline">
                      Builder
                    </span>
                  )}
                </>
              )}

              {status === 'authenticated' ? (
                <div className="ml-2 flex items-center gap-2 border-l border-line pl-3">
                  {!marketing && <ThemeToggle />}
                  <span className="hidden max-w-[10rem] truncate text-sm text-mist sm:inline">
                    {user?.displayName}
                  </span>
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="btn-ghost text-xs"
                  >
                    Sign out
                  </button>
                </div>
              ) : status !== 'loading' ? (
                <div className="ml-2 flex items-center gap-2">
                  {!marketing && <ThemeToggle />}
                  {cognitoEnabled ? (
                    <>
                      <Link
                        to="/signup"
                        className={
                          marketing ? 'btn-ghost text-xs' : 'btn-secondary text-xs'
                        }
                      >
                        Sign up
                      </Link>
                      <Link
                        to="/signin"
                        className={
                          marketing ? 'btn-ghost text-xs' : 'btn-primary text-xs'
                        }
                      >
                        Sign in
                      </Link>
                    </>
                  ) : (
                    <Link
                      to="/signin"
                      className={
                        marketing ? 'btn-ghost text-xs' : 'btn-primary text-xs'
                      }
                    >
                      Get started
                    </Link>
                  )}
                  {devAuthAllowed && (
                    <Link
                      to="/try"
                      className="btn-ghost hidden text-xs sm:inline-flex"
                    >
                      Try guest
                    </Link>
                  )}
                </div>
              ) : null}
            </nav>
          )}
        </div>
      </header>

      <main
        className={`min-h-0 flex-1 ${
          wide || marketing ? 'flex w-full flex-col' : 'mx-auto w-full max-w-6xl'
        }`}
      >
        {children}
      </main>
    </div>
  );
}
