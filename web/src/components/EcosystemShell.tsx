import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ensureChatWorkspace,
  listChatSessions,
  listProjects,
} from '../api/client';
import { useAuth } from '../auth/useAuth';
import { ShellProvider } from '../hooks/ShellProvider';
import { useShell } from '../hooks/useShell';

type RailItem = {
  to: string;
  label: string;
  end?: boolean;
  icon: ReactNode;
};

function IconChat() {
  return (
    <svg viewBox="0 0 24 24" className="h-[1.15rem] w-[1.15rem]" fill="none" aria-hidden>
      <path
        d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H11l-3.5 3.2V15H7.5A2.5 2.5 0 0 1 5 12.5v-6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg viewBox="0 0 24 24" className="h-[1.15rem] w-[1.15rem]" fill="none" aria-hidden>
      <path
        d="M3.5 8.5V7A2.5 2.5 0 0 1 6 4.5h3.2L11 6.5h7A2.5 2.5 0 0 1 20.5 9v8A2.5 2.5 0 0 1 18 19.5H6A2.5 2.5 0 0 1 3.5 17V8.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCode() {
  return (
    <svg viewBox="0 0 24 24" className="h-[1.15rem] w-[1.15rem]" fill="none" aria-hidden>
      <path
        d="m8 7-4 5 4 5M16 7l4 5-4 5M13 5l-2 14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconApps() {
  return (
    <svg viewBox="0 0 24 24" className="h-[1.15rem] w-[1.15rem]" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 4v3M12 17v3M4 12h3M17 12h3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconProfile() {
  return (
    <svg viewBox="0 0 24 24" className="h-[1.15rem] w-[1.15rem]" fill="none" aria-hidden>
      <circle cx="12" cy="9" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5.5 19.2c1.4-3 3.7-4.5 6.5-4.5s5.1 1.5 6.5 4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPanel() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <rect
        x="3.5"
        y="4.5"
        width="17"
        height="15"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M9 4.5v15" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function IconBuilder() {
  return (
    <svg viewBox="0 0 24 24" className="h-[1.15rem] w-[1.15rem]" fill="none" aria-hidden>
      <rect
        x="3.5"
        y="5"
        width="17"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M10.5 5v14" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function IconDeveloper() {
  return (
    <svg viewBox="0 0 24 24" className="h-[1.15rem] w-[1.15rem]" fill="none" aria-hidden>
      <path
        d="M8 8.5 4.5 12 8 15.5M16 8.5 19.5 12 16 15.5M13.2 6l-2.4 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const NAV_ITEMS: RailItem[] = [
  { to: '/app/chat', label: 'Chat', end: true, icon: <IconChat /> },
  { to: '/app/projects', label: 'Projects', icon: <IconFolder /> },
  { to: '/app/builder', label: 'Builder', icon: <IconBuilder /> },
  { to: '/app/code', label: 'Code', icon: <IconCode /> },
  { to: '/app/apps', label: 'Apps', icon: <IconApps /> },
  { to: '/app/developer', label: 'Developer', icon: <IconDeveloper /> },
];

function RailNavLink({
  item,
  expanded,
}: {
  item: RailItem;
  expanded: boolean;
}) {
  const location = useLocation();
  const builderActive =
    item.to === '/app/builder' &&
    (location.pathname === '/app/builder' ||
      location.pathname.includes('/builder'));
  const developerActive =
    item.to === '/app/developer' &&
    location.pathname.startsWith('/app/developer');

  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={item.label}
      aria-label={item.label}
      className={({ isActive }) => {
        const active =
          builderActive ||
          developerActive ||
          (item.to !== '/app/builder' &&
            item.to !== '/app/developer' &&
            isActive);
        return `interactive flex items-center gap-3 rounded-[var(--radius-control)] transition duration-150 ${
          expanded ? 'h-10 px-2.5' : 'h-10 w-10 justify-center'
        } ${
          active
            ? 'bg-raised text-paper ring-1 ring-line'
            : 'text-mist hover:bg-panel hover:text-paper'
        }`;
      }}
    >
      <span className="grid shrink-0 place-items-center">{item.icon}</span>
      {expanded && (
        <span className="truncate font-sans text-sm font-medium tracking-tight">
          {item.label}
        </span>
      )}
    </NavLink>
  );
}

function EcosystemRail() {
  const { expanded, toggle, setExpanded } = useShell();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [recents, setRecents] = useState<Array<{ id: string; title: string }>>(
    [],
  );
  const [projectCount, setProjectCount] = useState<number | null>(null);

  const refreshSideData = useCallback(async () => {
    try {
      const [{ id }, projects] = await Promise.all([
        ensureChatWorkspace(),
        listProjects(),
      ]);
      setProjectCount(projects.length);
      const sessions = await listChatSessions(id);
      setRecents(sessions.slice(0, 14));
    } catch {
      setRecents([]);
    }
  }, []);

  useEffect(() => {
    void refreshSideData();
  }, [refreshSideData, location.pathname]);

  useEffect(() => {
    const onSessionsChanged = () => {
      void refreshSideData();
    };
    window.addEventListener('wc:sessions-changed', onSessionsChanged);
    return () => {
      window.removeEventListener('wc:sessions-changed', onSessionsChanged);
    };
  }, [refreshSideData]);

  const onNewChat = () => {
    navigate('/app/chat', { state: { newChat: true } });
  };

  const displayName =
    user?.displayName?.trim() ||
    user?.email?.split('@')[0] ||
    'Account';

  return (
    <>
      {expanded && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-ink/55 backdrop-blur-[2px] md:hidden"
          aria-label="Close sidebar"
          onClick={() => setExpanded(false)}
        />
      )}

      <aside
        className={`relative z-40 flex h-full shrink-0 flex-col border-r border-line/80 bg-ink/55 py-3 backdrop-blur-xl transition-[width] duration-200 ease-out ${
          expanded
            ? 'fixed inset-y-0 left-0 w-[17rem] md:static md:w-[17rem]'
            : 'w-[4.25rem]'
        }`}
        aria-label="Ecosystem"
        data-expanded={expanded ? 'true' : 'false'}
      >
        <div
          className={`flex shrink-0 items-center gap-2 px-3 ${
            expanded ? 'justify-between' : 'flex-col'
          }`}
        >
          {expanded ? (
            <Link
              to="/app/chat"
              className="interactive flex min-w-0 items-center gap-2.5 rounded-[var(--radius-control)] px-1 py-1"
              aria-label="WalkCroach home"
            >
              <img
                src="/walkcroach-icon.png"
                alt=""
                className="h-8 w-8 shrink-0 rounded-lg object-cover"
                width={32}
                height={32}
              />
              <span className="truncate font-display text-[1.05rem] font-extrabold tracking-tight text-paper">
                WalkCroach
              </span>
            </Link>
          ) : (
            <Link
              to="/app/chat"
              className="interactive grid h-10 w-10 place-items-center"
              aria-label="WalkCroach home"
              title="WalkCroach"
            >
              <img
                src="/walkcroach-icon.png"
                alt=""
                className="h-8 w-8 rounded-lg object-cover"
                width={32}
                height={32}
              />
            </Link>
          )}

          <button
            type="button"
            onClick={toggle}
            className="interactive grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] text-mist hover:bg-panel hover:text-paper"
            aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-expanded={expanded}
            title={expanded ? 'Collapse (⌘B)' : 'Expand (⌘B)'}
          >
            <IconPanel />
          </button>
        </div>

        <div className={`mt-3 ${expanded ? 'px-3' : 'flex justify-center'}`}>
          <button
            type="button"
            onClick={onNewChat}
            className={`interactive flex items-center gap-2.5 rounded-[var(--radius-control)] border border-line bg-raised/70 text-paper transition hover:border-signal/40 hover:bg-raised ${
              expanded
                ? 'h-10 w-full px-2.5 font-sans text-sm font-semibold'
                : 'h-10 w-10 justify-center'
            }`}
            aria-label="New chat"
            title="New chat"
          >
            <IconPlus />
            {expanded && <span>New chat</span>}
          </button>
        </div>

        <nav
          className={`mt-4 flex flex-col gap-0.5 ${expanded ? 'px-3' : 'items-center'}`}
          aria-label="Primary"
        >
          {NAV_ITEMS.map((item) => (
            <RailNavLink key={item.to} item={item} expanded={expanded} />
          ))}
        </nav>

        {expanded && (
          <div className="mt-5 flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-3">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <p className="px-2.5 font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-mist/75">
                Recents
              </p>
              {recents.length === 0 ? (
                <p className="mt-2 px-2.5 text-xs leading-relaxed text-mist/70">
                  Chats you start will show up here.
                </p>
              ) : (
                <ul className="mt-1.5 space-y-0.5">
                  {recents.map((s) => {
                    const active = location.pathname.includes(s.id);
                    return (
                      <li key={s.id}>
                        <Link
                          to={`/app/chat/${s.id}`}
                          className={`interactive block truncate rounded-[var(--radius-control)] px-2.5 py-2 text-[13px] leading-snug transition ${
                            active
                              ? 'bg-raised text-paper'
                              : 'text-mist hover:bg-panel/80 hover:text-paper'
                          }`}
                          title={s.title}
                        >
                          {s.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {projectCount !== null && projectCount > 0 && (
              <div className="shrink-0 border-t border-line pt-3">
                <Link
                  to="/app/projects"
                  className="interactive flex items-center justify-between rounded-[var(--radius-control)] px-2.5 py-2 text-mist hover:bg-panel/80 hover:text-paper"
                >
                  <span className="text-[13px] font-medium">Projects</span>
                  <span className="font-mono text-[11px] tabular-nums text-mist/80">
                    {projectCount}
                  </span>
                </Link>
              </div>
            )}
          </div>
        )}

        {!expanded && <div className="flex-1" />}

        <div
          className={`mt-auto shrink-0 border-t border-line pt-3 ${
            expanded ? 'px-3' : 'flex justify-center'
          }`}
        >
          <NavLink
            to="/app/settings"
            title="Profile & settings"
            aria-label="Profile & settings"
            className={({ isActive }) =>
              `interactive flex items-center gap-3 rounded-[var(--radius-control)] transition ${
                expanded ? 'h-12 px-2' : 'h-10 w-10 justify-center'
              } ${
                isActive
                  ? 'bg-raised text-paper'
                  : 'text-mist hover:bg-panel hover:text-paper'
              }`
            }
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-panel ring-1 ring-line">
              <IconProfile />
            </span>
            {expanded && (
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-semibold text-paper">
                  {displayName}
                </span>
                <span className="block truncate text-[11px] text-mist">
                  Settings
                </span>
              </span>
            )}
          </NavLink>
        </div>
      </aside>
    </>
  );
}

function EcosystemShellInner({ children }: { children?: ReactNode }) {
  const location = useLocation();
  const focusBuilder =
    location.pathname.includes('/builder') ||
    location.pathname.startsWith('/project/');

  // Builder owns the viewport (its own AppShell) — no ecosystem rail.
  if (focusBuilder) {
    return <>{children ?? <Outlet />}</>;
  }

  return (
    <div className="flex h-full min-h-0 text-paper">
      <EcosystemRail />
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {children ?? <Outlet />}
      </main>
    </div>
  );
}

/**
 * Ecosystem shell — collapsible rail (Claude-like openable sidebar).
 */
export function EcosystemShell({ children }: { children?: ReactNode }) {
  return (
    <ShellProvider>
      <EcosystemShellInner>{children}</EcosystemShellInner>
    </ShellProvider>
  );
}
