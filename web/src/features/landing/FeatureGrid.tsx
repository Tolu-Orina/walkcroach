import { Glass } from '../../components/Glass';
import { Reveal, Stagger, StaggerItem } from '../../components/Reveal';

const FEATURES = [
  {
    title: 'Recall',
    body: 'Vector memory surfaces past decisions — stack, tone, and layout — on every turn.',
    image: '/marketing/landing-memory-glass.png',
    imageAlt: 'Glass memory panel',
  },
  {
    title: 'Plan → Build',
    body: 'Approve a file plan before multi-file writes land in your live preview.',
    image: '/marketing/landing-builder-glass.png',
    imageAlt: 'Glass builder preview frame',
  },
  {
    title: 'Preview',
    body: 'Cloud sandbox runs your app. Open terminal and files only when you need them.',
    image: '/marketing/landing-builder-glass.png',
    imageAlt: 'App preview in glass frame',
  },
] as const;

export function FeatureGrid() {
  return (
    <section className="px-4 py-16 sm:px-5 lg:py-20">
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Product</p>
        <h2 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-paper md:text-3xl">
          From intent to running app
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-mist md:text-base">
          One continuous surface — Chat for thinking, Projects for knowledge,
          Builder for shipping.
        </p>
      </Reveal>

      <Stagger className="mx-auto mt-12 grid max-w-6xl gap-5 md:grid-cols-3">
        {FEATURES.map((feature) => (
          <StaggerItem key={feature.title}>
            <Glass
              hairline
              className="group flex h-full flex-col overflow-hidden transition duration-300 hover:border-teal/35"
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <img
                  src={feature.image}
                  alt={feature.imageAlt}
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                  width={800}
                  height={600}
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/10 to-transparent" />
              </div>
              <div className="flex flex-1 flex-col px-5 py-5">
                <h3 className="font-display text-lg font-bold tracking-tight text-signal">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-mist">
                  {feature.body}
                </p>
              </div>
            </Glass>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}
