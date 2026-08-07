import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';

export type SurfaceCard = {
  id: string;
  name: string;
  blurb: string;
  image: string;
  imageAlt: string;
  href: string;
  cta: string;
  /** External download / outbound URL (not an in-app route). */
  external?: boolean;
};

type Props = {
  id: string;
  eyebrow: string;
  title: string;
  support: string;
  surfaces: [SurfaceCard, SurfaceCard];
};

export function SurfacePairSection({
  id,
  eyebrow,
  title,
  support,
  surfaces,
}: Props) {
  const reduce = useReducedMotion();

  return (
    <section
      id={id}
      className="w-[95%] mx-auto border-b border-[var(--lp-line)] px-5 py-16 sm:px-6 lg:px-7 lg:py-24"
    >
      <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="lp-eyebrow">{eyebrow}</p>
          <h2 className="mt-3 max-w-2xl font-display text-3xl font-extrabold tracking-tight text-[var(--lp-ink)] sm:text-4xl">
            {title}
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-[var(--lp-muted)]">
            {support}
          </p>
        </motion.div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {surfaces.map((surface, i) => (
            <motion.article
              key={surface.id}
              id={`surfaces-${surface.id}`}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{
                duration: 0.45,
                delay: reduce ? 0 : i * 0.08,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="lp-card group"
            >
              <div className="relative aspect-[3/2] overflow-hidden bg-[var(--lp-canvas-deep)]">
                <img
                  src={surface.image}
                  alt={surface.imageAlt}
                  width={1536}
                  height={1024}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover object-center transition duration-500 group-hover:scale-[1.02]"
                />
              </div>
              <div className="p-6">
                <h3 className="font-display text-xl font-extrabold tracking-tight text-[var(--lp-ink)]">
                  {surface.name}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-[var(--lp-muted)]">
                  {surface.blurb}
                </p>
                {surface.external || surface.href.startsWith('#') ? (
                  <a
                    href={surface.href}
                    className="mt-5 inline-flex text-sm font-extrabold text-[var(--lp-accent)] underline-offset-4 hover:underline"
                    {...(surface.external
                      ? { rel: 'noopener noreferrer' }
                      : {})}
                  >
                    {surface.cta}
                  </a>
                ) : (
                  <Link
                    to={surface.href}
                    className="mt-5 inline-flex text-sm font-extrabold text-[var(--lp-accent)] underline-offset-4 hover:underline"
                  >
                    {surface.cta}
                  </Link>
                )}
              </div>
            </motion.article>
          ))}
        </div>
    </section>
  );
}
