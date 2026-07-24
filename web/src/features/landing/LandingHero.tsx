import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { Glass } from '../../components/Glass';
import { easeOutExpo, fadeUp, scaleIn, staggerContainer } from '../../lib/motion';

type LandingHeroProps = {
  onStartPrompt: (prompt: string) => void | Promise<void>;
  busy?: boolean;
  authenticated?: boolean;
  cognitoEnabled: boolean;
  devAuthAllowed: boolean;
  onDevStart: () => void;
  onTryGuest: () => void;
};

/**
 * Hero only — Graphite Lumen.
 * Left: headline + glass composer. Right: product visual (fills the half).
 * Brand stays in the nav.
 */
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
  const reduce = useReducedMotion();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    void onStartPrompt(text);
  };

  const copy = (
    <>
      <motion.h1
        variants={fadeUp}
        className="font-display text-[2.55rem] font-extrabold leading-[1.02] tracking-[-0.04em] text-paper sm:text-5xl md:text-[3.2rem]"
      >
        Build apps that remember you.
      </motion.h1>

      <motion.p
        variants={fadeUp}
        className="mt-5 max-w-md text-base leading-relaxed text-mist md:text-lg"
      >
        Describe what you want. Preferences and context persist across Chat,
        Projects, and App Builder.
      </motion.p>

      <motion.div variants={fadeUp} className="mt-9">
        <Glass strong hairline as="form" onSubmit={submit} className="p-3">
          <label htmlFor="landing-prompt" className="sr-only">
            Describe your app
          </label>
          <textarea
            id="landing-prompt"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe your app — muted landing, waitlist, SaaS shell…"
            className="field resize-none border-0 bg-transparent text-[15px] text-paper placeholder:text-mist/60 focus:border-transparent"
            disabled={busy}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 pb-0.5">
            <p className="text-[12px] text-mist">Enter to start</p>
            <motion.button
              type="submit"
              disabled={busy || !prompt.trim()}
              className="btn-primary text-xs"
              whileHover={reduce ? undefined : { scale: 1.02 }}
              whileTap={reduce ? undefined : { scale: 0.98 }}
              transition={{ duration: 0.15 }}
            >
              {busy ? 'Starting…' : 'Start building'}
            </motion.button>
          </div>
        </Glass>
      </motion.div>

      <motion.div
        variants={fadeUp}
        className="mt-6 flex flex-wrap items-center gap-2.5"
      >
        {authenticated ? (
          <Link to="/app/chat" className="btn-secondary text-sm !font-extrabold">
            Open Chat
          </Link>
        ) : cognitoEnabled ? (
          <>
            <Link to="/signup" className="btn-secondary text-sm !font-extrabold">
              Create account
            </Link>
            <Link to="/signin" className="btn-ghost text-sm !font-extrabold">
              Sign in
            </Link>
          </>
        ) : (
          <button
            type="button"
            onClick={onDevStart}
            className="btn-secondary text-sm !font-extrabold"
          >
            Dev sign-in
          </button>
        )}
        {!authenticated && devAuthAllowed && (
          <button
            type="button"
            onClick={onTryGuest}
            className="btn-ghost text-sm !font-extrabold"
          >
            Try without signing in
          </button>
        )}
      </motion.div>
    </>
  );

  return (
    <section className="relative isolate min-h-[min(82dvh,44rem)] overflow-hidden">
      <div className="absolute inset-0 -z-10 size-full">
        <motion.img
          src="/marketing/landing-hero-graphite.png"
          alt=""
          className="absolute inset-0 size-full object-cover object-center"
          width={1920}
          height={1080}
          initial={reduce ? false : { scale: 1.04, opacity: 0.8 }}
          animate={reduce ? undefined : { scale: 1, opacity: 1 }}
          transition={{ duration: 1.1, ease: easeOutExpo }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/75 to-ink/25 lg:via-ink/60 lg:to-ink/15" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/95 via-transparent to-ink/40" />
      </div>

      <div className="relative mx-auto grid min-h-[min(82dvh,44rem)] w-full max-w-[90rem] items-center gap-8 px-4 py-12 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10 lg:py-14">
        <div className="flex items-center">
          {reduce ? (
            <div className="w-full max-w-xl">{copy}</div>
          ) : (
            <motion.div
              className="w-full max-w-xl"
              variants={staggerContainer}
              initial="hidden"
              animate="show"
            >
              {copy}
            </motion.div>
          )}
        </div>

        <motion.div
          className="relative mx-auto w-full max-w-lg lg:max-w-xl lg:justify-self-end"
          variants={scaleIn}
          initial={reduce ? false : 'hidden'}
          animate="show"
          transition={{ delay: 0.15 }}
        >
          <Glass
            hairline
            className="relative aspect-[4/3] w-full overflow-hidden p-0"
          >
            <img
              src="/marketing/landing-hero-product.png"
              alt="WalkCroach product preview — chat and app canvas in frosted glass"
              className="absolute inset-0 size-full object-cover object-center"
              width={1200}
              height={900}
              loading="eager"
              decoding="async"
            />
            <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/10" />
          </Glass>
          <div className="pointer-events-none absolute -right-8 top-1/4 h-40 w-40 rounded-full bg-signal/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-10 left-1/4 h-36 w-36 rounded-full bg-teal/20 blur-3xl" />
        </motion.div>
      </div>
    </section>
  );
}
