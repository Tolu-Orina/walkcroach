export function LandingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line px-6 py-10 lg:px-10">
      <div className="flex w-full flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-display text-lg font-bold text-paper">WalkCroach</p>
          <p className="mt-1 text-sm text-mist">
            Memory-first AI web builder. Built for the CockroachDB × AWS Hackathon.
          </p>
        </div>

        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-mist" aria-label="Footer">
          <a
            href="https://walkcroach.conquerorfoundation.com"
            className="interactive hover:text-paper"
            target="_blank"
            rel="noreferrer"
          >
            Product
          </a>
          <a
            href="https://www.cockroachlabs.com/"
            className="interactive hover:text-paper"
            target="_blank"
            rel="noreferrer"
          >
            CockroachDB
          </a>
          <a
            href="https://aws.amazon.com/"
            className="interactive hover:text-paper"
            target="_blank"
            rel="noreferrer"
          >
            AWS
          </a>
        </nav>
      </div>

      <p className="mt-8 w-full text-[11px] text-mist/80">
        © {year} WalkCroach · walkcroach.conquerorfoundation.com
      </p>
    </footer>
  );
}
