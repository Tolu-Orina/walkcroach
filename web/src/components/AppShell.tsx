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
        `interactive rounded-sm px-2.5 py-1.5 text-sm ${
          isActive ? 'text-paper' : 'text-mist hover:text-paper'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

export function AppShell({ children, wide = false, minimal = false, marketing = false }: AppShellProps) {
  const { status, signOut, cognitoEnabled, devAuthAllowed, user } = useAuth();
  const location = useLocation();
  const onBuilder =
    location.pathname.startsWith('/project/') || location.pathname === '/try';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-line bg-ink/80 backdrop-blur-sm">
        <div
          className={`flex items-center justify-between gap-4 px-4 py-3 sm:px-6 ${
            wide || marketing ? 'w-full' : 'mx-auto max-w-6xl'
          }`}
        >
          <BrandLogo to="/" />

          {!minimal && (
            <nav
              className="flex flex-1 items-center justify-end gap-1 sm:gap-2"
              aria-label="Main"
            >
              {status === 'authenticated' && (
                <>
                  <NavItem to="/dashboard" end>
                    Projects
                  </NavItem>
                  {onBuilder && (
                    <span className="hidden text-xs text-mist/60 sm:inline">
                      Builder
                    </span>
                  )}
                </>
              )}

              {status === 'authenticated' ? (
                <div className="ml-2 flex items-center gap-3 border-l border-line pl-3">
                  <ThemeToggle />
                  <span className="hidden max-w-[10rem] truncate text-xs text-mist sm:inline">
                    {user?.displayName}
                  </span>
                  <button
                    type="button"
                    onClick={signOut}
                    className="btn-ghost text-xs"
                  >
                    Sign out
                  </button>
                </div>
              ) : status !== 'loading' ? (
                <div className="ml-2 flex items-center gap-2">
                  <ThemeToggle />
                  {cognitoEnabled ? (
                    <>
                      <Link to="/signup" className="btn-secondary text-xs">
                        Sign up
                      </Link>
                      <Link to="/signin" className="btn-primary text-xs">
                        Sign in
                      </Link>
                    </>
                  ) : (
                    <Link to="/signin" className="btn-primary text-xs">
                      Get started
                    </Link>
                  )}
                  {devAuthAllowed && (
                    <Link to="/try" className="btn-ghost hidden text-xs sm:inline-flex">
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
        className={`min-h-0 flex-1 ${wide || marketing ? 'flex w-full flex-col' : 'mx-auto w-full max-w-6xl'}`}
      >
        {children}
      </main>
    </div>
  );
}
