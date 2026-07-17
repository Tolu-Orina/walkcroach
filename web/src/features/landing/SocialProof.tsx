const STATS = [
  { value: '<8s', label: 'Target preview boot' },
  { value: 'Plan → Build', label: 'Approval before writes' },
  { value: 'CRDB', label: 'Memory + projects persist' },
  { value: '1-click', label: 'Deploy to your subdomain' },
] as const;

const BADGES = [
  'CockroachDB × AWS Hackathon',
  'WebContainer in-browser',
  'GitHub sync',
] as const;

export function SocialProof() {
  return (
    <section className="px-6 py-12 lg:px-10">
      <div className="w-full">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((stat) => (
            <li
              key={stat.label}
              className="rounded-sm border border-line bg-panel/40 px-4 py-5 text-center"
            >
              <p className="font-display text-2xl font-bold text-signal">{stat.value}</p>
              <p className="mt-1 text-xs text-mist">{stat.label}</p>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {BADGES.map((badge) => (
            <span
              key={badge}
              className="rounded-full border border-line px-3 py-1 text-[11px] text-mist"
            >
              {badge}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
