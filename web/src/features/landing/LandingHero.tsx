import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

const PROMPT_CHIPS = [
  'Build a muted landing page with a contact CTA',
  'Todo app with localStorage persistence',
  'SaaS marketing page with a trial button',
] as const;

type LandingHeroProps = {
  onStartPrompt: (prompt: string) => void | Promise<void>;
  busy?: boolean;
  authenticated?: boolean;
  cognitoEnabled: boolean;
  devAuthAllowed: boolean;
  onDevStart: () => void;
  onTryGuest: () => void;
};

export function LandingHero({
  onStartPrompt,
  busy = false,
  authenticated = false,
  cognitoEnabled,
  devAuthAllowed,
  onDevStart,
  onTryGuest,
}: LandingHeroProps) {
  const [prompt, setPrompt] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    void onStartPrompt(text);
  };

  return (
    <section className="relative px-6 py-12 sm:py-16 lg:px-10 lg:py-20">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(200,245,66,0.08),transparent_55%)]" />

      <div className="relative grid w-full items-start gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-12 xl:gap-16">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.2em] text-signal">
            Memory-first builder
          </p>
          <h1 className="mt-3 font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-paper md:text-5xl">
            Build apps that remember you.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-mist md:text-lg">
            Describe what you want. WalkCroach recalls your stack, tone, and layout
            choices across sessions — so you never re-explain the basics.
          </p>

          <form onSubmit={submit} className="mt-8">
            <label htmlFor="landing-prompt" className="sr-only">
              Describe your app
            </label>
            <div className="rounded-sm border border-line bg-panel/60 p-2 shadow-lg shadow-ink/20 focus-within:border-signal/50">
              <textarea
                id="landing-prompt"
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe your app — e.g. muted landing page with waitlist form…"
                className="field resize-none border-0 bg-transparent focus:border-transparent"
                disabled={busy}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1">
                <p className="text-[11px] text-mist">Enter to start · picks a starter template</p>
                <button
                  type="submit"
                  disabled={busy || !prompt.trim()}
                  className="btn-primary text-xs"
                >
                  {busy ? 'Starting…' : 'Start building'}
                </button>
              </div>
            </div>
          </form>

          <div className="mt-3 flex flex-wrap gap-2">
            {PROMPT_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                disabled={busy}
                onClick={() => setPrompt(chip)}
                className="interactive rounded-sm border border-line px-2.5 py-1 text-[11px] text-mist hover:border-signal/40 hover:text-paper disabled:opacity-50"
              >
                {chip.length > 42 ? `${chip.slice(0, 39)}…` : chip}
              </button>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {authenticated ? (
              <Link to="/dashboard" className="btn-primary text-sm">
                Your projects
              </Link>
            ) : cognitoEnabled ? (
              <>
                <Link to="/signup" className="btn-secondary text-sm">
                  Create account
                </Link>
                <Link to="/signin" className="btn-ghost text-sm">
                  Sign in
                </Link>
              </>
            ) : (
              <button type="button" onClick={onDevStart} className="btn-secondary text-sm">
                Dev sign-in
              </button>
            )}
            {!authenticated && devAuthAllowed && (
              <button type="button" onClick={onTryGuest} className="btn-ghost text-sm">
                Try without signing in
              </button>
            )}
          </div>
        </div>

        <figure className="mx-auto w-full max-w-md shrink-0 sm:max-w-lg lg:mx-0 lg:max-w-xl lg:pt-2 xl:max-w-2xl">
          <div className="overflow-hidden rounded-md border border-line bg-ink shadow-xl shadow-ink/40 ring-1 ring-signal/15">
            <img
              src="/walkcroach-banner.png"
              alt="WalkCroach builder — chat, live preview, and deploy in one workspace"
              className="block h-auto w-full"
              width={1536}
              height={1024}
              loading="eager"
              decoding="async"
            />
          </div>
          <figcaption className="mt-2 text-center text-[10px] leading-snug text-mist lg:text-left">
            Plan → build → preview → deploy
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
