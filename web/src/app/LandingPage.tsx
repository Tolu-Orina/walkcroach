import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function LandingPage() {
  const { status, signIn, signInAnonymous, cognitoEnabled, devAuthAllowed } = useAuth();
  const navigate = useNavigate();

  if (status === 'loading') {
    return (
      <div className="grid h-full place-items-center text-sm text-mist">Loading…</div>
    );
  }

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSignIn = () => {
    signIn();
    if (!cognitoEnabled) navigate('/dashboard');
  };

  const handleTry = () => {
    signInAnonymous();
    navigate('/try');
  };

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col justify-center px-6 py-12">
      <p className="text-[11px] uppercase tracking-[0.2em] text-signal">WalkCroach</p>
      <h1 className="mt-3 font-display text-4xl font-extrabold leading-tight tracking-tight text-paper md:text-5xl">
        Build apps that remember you.
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-mist md:text-lg">
        A memory-first web builder backed by CockroachDB. Your preferences, layout
        decisions, and stack choices persist across sessions — so the agent does not
        re-ask what you already decided.
      </p>

      <ul className="mt-8 grid gap-3 text-sm text-paper/90 md:grid-cols-3">
        <li className="rounded-sm border border-line bg-panel/40 px-4 py-3">
          <span className="font-medium text-signal">Recall</span>
          <p className="mt-1 text-mist">Vector memory surfaces past decisions in every turn.</p>
        </li>
        <li className="rounded-sm border border-line bg-panel/40 px-4 py-3">
          <span className="font-medium text-signal">Plan → Build</span>
          <p className="mt-1 text-mist">Approve a file plan before multi-file writes land.</p>
        </li>
        <li className="rounded-sm border border-line bg-panel/40 px-4 py-3">
          <span className="font-medium text-signal">Preview</span>
          <p className="mt-1 text-mist">WebContainer runs your app in-browser — no local Node.</p>
        </li>
      </ul>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSignIn}
          className="rounded-sm bg-signal px-6 py-2.5 text-sm font-medium uppercase tracking-wide text-ink"
        >
          {cognitoEnabled ? 'Sign in' : 'Get started'}
        </button>
        {devAuthAllowed && (
          <button
            type="button"
            onClick={handleTry}
            className="rounded-sm border border-line px-6 py-2.5 text-sm text-paper hover:border-signal/40"
          >
            Try without signing in
          </button>
        )}
      </div>
      <p className="mt-4 text-[11px] text-mist">
        {devAuthAllowed
          ? 'Guest sessions are capped and not listed on your dashboard. Sign in to keep projects.'
          : 'Sign in with your account to create and keep projects.'}
      </p>
    </div>
  );
}
