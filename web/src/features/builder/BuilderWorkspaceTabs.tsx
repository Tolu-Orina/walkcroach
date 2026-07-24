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

/**
 * Ship / Data / Versions — collapsed by default; click a tab to expand,
 * click the active tab again (or Collapse) to hide the panel body.
 */
export function BuilderWorkspaceTabs({
  ship,
  data,
  versions,
}: BuilderWorkspaceTabsProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('ship');
  const [expanded, setExpanded] = useState(false);

  const panels = { ship, data, versions };

  const selectTab = (id: (typeof TABS)[number]['id']) => {
    if (expanded && tab === id) {
      setExpanded(false);
      return;
    }
    setTab(id);
    setExpanded(true);
  };

  return (
    <div className="shrink-0 border-t border-line bg-panel/70">
      <div
        className="flex items-center gap-1 px-2 py-1.5"
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
            aria-selected={expanded && tab === t.id}
            aria-expanded={expanded && tab === t.id}
            aria-controls={`builder-panel-${t.id}`}
            onClick={() => selectTab(t.id)}
            className={`interactive rounded-[var(--radius-control)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
              expanded && tab === t.id
                ? 'bg-raised text-paper'
                : 'text-mist hover:bg-raised/50 hover:text-paper'
            }`}
          >
            {t.label}
          </button>
        ))}
        {expanded && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="interactive ml-auto px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-mist hover:text-paper"
            aria-label="Collapse panel"
          >
            Collapse
          </button>
        )}
      </div>
      {expanded && (
        <div
          role="tabpanel"
          id={`builder-panel-${tab}`}
          aria-labelledby={`builder-tab-${tab}`}
          className="max-h-52 overflow-y-auto border-t border-line/60"
        >
          {panels[tab]}
        </div>
      )}
    </div>
  );
}
