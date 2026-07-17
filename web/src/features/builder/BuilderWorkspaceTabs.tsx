import { useState, type ReactNode } from 'react';

type BuilderWorkspaceTabsProps = {
  ship: ReactNode;
  data: ReactNode;
  versions: ReactNode;
};

const TABS = [
  { id: 'ship' as const, label: 'Ship' },
  { id: 'data' as const, label: 'Data' },
  { id: 'versions' as const, label: 'Versions' },
];

export function BuilderWorkspaceTabs({
  ship,
  data,
  versions,
}: BuilderWorkspaceTabsProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('ship');

  const panels = { ship, data, versions };

  return (
    <div className="shrink-0 border-t border-line bg-ink/50">
      <div
        className="flex border-b border-line"
        role="tablist"
        aria-label="Project tools"
        data-wc-tour="ship-tools"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`builder-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`builder-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`interactive flex-1 px-3 py-2 text-[11px] font-medium uppercase tracking-wider sm:flex-none sm:px-5 ${
              tab === t.id
                ? 'border-b-2 border-signal text-paper'
                : 'text-mist hover:text-paper'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`builder-panel-${tab}`}
        aria-labelledby={`builder-tab-${tab}`}
        className="max-h-56 overflow-y-auto"
      >
        {panels[tab]}
      </div>
    </div>
  );
}
