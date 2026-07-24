import { Link } from 'react-router-dom';

export function LandingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto w-full border-t border-line/80">
      <div className="flex w-full flex-col gap-8 px-4 py-10 sm:px-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-display text-lg font-extrabold tracking-tight text-paper">
            WalkCroach
          </p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-mist">
            Memory-first AI web builder. Continuity across Chat, Projects, and
            App Builder.
          </p>
        </div>

        <nav
          className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-mist"
          aria-label="Footer"
        >
          <Link to="/app/chat" className="interactive hover:text-paper">
            Chat
          </Link>
          <Link to="/signin" className="interactive hover:text-paper">
            Sign in
          </Link>
          <a
            href="https://walkcroach.conquerorfoundation.com"
            className="interactive hover:text-paper"
            target="_blank"
            rel="noreferrer"
          >
            Live product
          </a>
        </nav>
      </div>

      <div className="w-full border-t border-line/60 px-4 py-4 sm:px-5">
        <p className="text-[11px] text-mist/75">
          © {year} WalkCroach · walkcroach.conquerorfoundation.com
        </p>
      </div>
    </footer>
  );
}
