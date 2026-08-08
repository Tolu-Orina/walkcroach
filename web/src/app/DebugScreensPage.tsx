import { Link, Navigate } from 'react-router-dom';
import { allowDevAuth } from '../auth/cognito-config';
import { markWelcomeComplete } from '../auth/session';
import { useAuth } from '../auth/useAuth';

const SCREENS: Array<{ path: string; label: string; note?: string }> = [
  { path: '/', label: 'Landing' },
  { path: '/signin', label: 'Sign in' },
  { path: '/signup', label: 'Sign up' },
  { path: '/welcome', label: 'Welcome' },
  { path: '/app/chat', label: 'Chat home' },
  { path: '/app/projects', label: 'Projects list' },
  { path: '/app/code', label: 'Code library' },
  { path: '/app/apps', label: 'Apps hub' },
  { path: '/app/settings', label: 'Profile / settings' },
  {
    path: '/app/projects',
    label: 'Project home',
    note: 'Open a project from the list, or create one first',
  },
  { path: '/try', label: 'Guest builder (/try)' },
];

/**
 * Local-only screen map for UI debugging (VITE_ALLOW_DEV_AUTH=true).
 */
export function DebugScreensPage() {
  const { status, signIn, user, signOut } = useAuth();

  if (!allowDevAuth()) {
    return <Navigate to="/" replace />;
  }

  const enterAsBuilder = () => {
    markWelcomeComplete();
    if (status !== 'authenticated') {
      signIn('Local Debugger');
    }
  };

  return (
    <div className="min-h-full bg-ink px-6 py-10 text-paper">
      <div className="mx-auto max-w-xl">
        <p className="text-[11px] uppercase tracking-[0.2em] text-signal">
          Local debug
        </p>
        <h1 className="mt-2 font-display text-3xl font-extrabold">
          Screen map
        </h1>
        <p className="mt-2 text-sm text-mist">
          Dev auth is on. Sign in as Builder so API calls send{' '}
          <code className="text-paper">Bearer dev:user:…</code>, then open any
          surface.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={enterAsBuilder}
            className="btn-primary text-xs"
          >
            {status === 'authenticated'
              ? 'Welcome marked · stay signed in'
              : 'Sign in as Builder (dev)'}
          </button>
          {status === 'authenticated' && (
            <button type="button" onClick={() => void signOut()} className="btn-ghost text-xs">
              Sign out
            </button>
          )}
        </div>

        <p className="mt-3 text-xs text-mist">
          Status: <span className="text-paper">{status}</span>
          {user ? ` · ${user.displayName}` : ''}
        </p>

        <ul className="mt-8 divide-y divide-line border border-line">
          {SCREENS.map((s) => (
            <li key={`${s.path}-${s.label}`}>
              <Link
                to={s.path}
                className="interactive flex flex-col gap-0.5 px-4 py-3 hover:bg-panel/50"
              >
                <span className="font-sans text-sm text-paper">{s.label}</span>
                <span className="font-mono text-[11px] text-mist">{s.path}</span>
                {s.note && (
                  <span className="text-[11px] text-mist/80">{s.note}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
