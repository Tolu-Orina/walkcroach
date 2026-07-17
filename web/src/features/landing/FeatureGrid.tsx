const FEATURES = [
  {
    title: 'Recall',
    body: 'Vector memory surfaces past decisions in every turn — stack, tone, and layout.',
  },
  {
    title: 'Plan → Build',
    body: 'Approve a file plan before multi-file writes land in your preview.',
  },
  {
    title: 'Preview',
    body: 'WebContainer runs your app in-browser. No local Node install required.',
  },
] as const;

export function FeatureGrid() {
  return (
    <section className="px-6 pb-14 lg:px-10">
      <div className="w-full">
        <ul className="grid gap-3 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <li
              key={feature.title}
              className="rounded-sm border border-line bg-panel/40 px-4 py-4"
            >
              <span className="font-display text-lg font-bold text-signal">{feature.title}</span>
              <p className="mt-2 text-sm leading-relaxed text-mist">{feature.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
