import { Glass } from '../../components/Glass';
import { Reveal, Stagger, StaggerItem } from '../../components/Reveal';

const STATS = [
  { value: '<8s', label: 'Target preview boot' },
  { value: 'Plan → Build', label: 'Approval before writes' },
  { value: 'Persistent', label: 'Memory across sessions' },
  { value: '1-click', label: 'Deploy to your subdomain' },
] as const;

export function SocialProof() {
  return (
    <section className="relative px-4 py-14 sm:px-5">
      <Reveal>
        <p className="eyebrow text-center">Built for continuity</p>
      </Reveal>
      <Stagger className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <StaggerItem key={stat.label}>
            <Glass
              hairline
              className="h-full px-4 py-6 text-center transition duration-300 hover:border-teal/35"
            >
              <p className="font-display text-2xl font-extrabold tracking-tight text-signal">
                {stat.value}
              </p>
              <p className="mt-2 text-xs leading-snug text-mist">{stat.label}</p>
            </Glass>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}
