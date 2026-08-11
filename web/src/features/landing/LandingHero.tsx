import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import {
  desktopDownloadHref,
  desktopDownloadIsExternal,
} from './desktopDownload';
import { HeroProductPreview } from './HeroProductPreview';

type Props = {
  authenticated?: boolean;
  showGuest?: boolean;
};

/** Product-first hero — PM copy (2026-08-11); live shared-memory preview. */
export function LandingHero({ authenticated = false, showGuest = false }: Props) {
  const reduce = useReducedMotion();
  const desktopHref = desktopDownloadHref();
  const desktopExternal = desktopDownloadIsExternal();

  return (
    <section className="relative w-full border-b border-[var(--lp-line)]">
      <div className="grid w-full items-center gap-10 px-5 py-16 sm:px-8 lg:grid-cols-2 lg:gap-12 lg:px-10 lg:py-20">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-xl"
        >
          <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-[-0.03em] text-[var(--lp-ink)] sm:text-5xl lg:text-[3.25rem]">
            One memory.
            <span className="mt-2 block">
              Every surface you{' '}
              <em className="italic font-extrabold text-[var(--lp-accent-bright)]">
                build
              </em>{' '}
              on.
            </span>
          </h1>
          <p className="mt-6 text-lg font-medium leading-relaxed text-[var(--lp-muted)] sm:text-xl">
            Ask something in the browser, get the answer in your terminal.
            WalkCroach keeps a single shared memory behind Web, your IDE, the
            CLI, and everything else — so context never gets left behind when
            you switch tools.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {authenticated ? (
              <>
                <Link to="/app/builder" className="lp-btn-primary">
                  Get started
                </Link>
                <a href="#pair-ide-cli" className="lp-btn-secondary">
                  Coding agents
                </a>
                <Link
                  to="/app/developer"
                  className="interactive text-sm font-extrabold text-[var(--lp-accent)] underline-offset-4 hover:underline"
                >
                  Developer API
                </Link>
              </>
            ) : (
              <>
                <Link to="/signup" className="lp-btn-primary">
                  Get started
                </Link>
                <a href="#pair-ide-cli" className="lp-btn-secondary">
                  Coding agents
                </a>
                {showGuest && (
                  <Link to="/try" className="lp-btn-secondary">
                    Try guest
                  </Link>
                )}
              </>
            )}
          </div>
          <p className="mt-4 text-sm text-[var(--lp-muted)]">
            Free to start · Same memory on every surface
          </p>
          <p className="mt-3 text-sm font-medium text-[var(--lp-muted)]">
            <a
              href={desktopHref}
              className="interactive font-extrabold text-[var(--lp-accent)] underline-offset-4 hover:underline"
              {...(desktopExternal ? { rel: 'noopener noreferrer' } : {})}
            >
              Download Desktop IDE
            </a>
            <span aria-hidden> · </span>
            <span>Windows preview · unsigned</span>
          </p>
        </motion.div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
          className="w-full"
        >
          <HeroProductPreview />
        </motion.div>
      </div>
    </section>
  );
}
