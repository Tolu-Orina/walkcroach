import {
  IconAccount,
  IconPage,
  IconRecall,
  IconSaved,
} from './icons';

export type TabId = 'page' | 'recall' | 'saved' | 'account';

const TABS: Array<{
  id: TabId;
  label: string;
  Icon: (p: { className?: string }) => React.ReactElement;
}> = [
  { id: 'page', label: 'Page', Icon: IconPage },
  { id: 'recall', label: 'Captures', Icon: IconRecall },
  { id: 'saved', label: 'Saved', Icon: IconSaved },
  { id: 'account', label: 'Account', Icon: IconAccount },
];

/**
 * Secondary navigation, pinned to the bottom (plan §3.2).
 *
 * Below the content on purpose: the panel's job on open is "act on this page",
 * so Captures / Saved / Account must not compete with it for the first glance.
 * Labels are hidden by CSS under ~340px and returned by a container query —
 * width-driven, so it responds to the panel the user dragged rather than to
 * their monitor.
 *
 * `Captures` is Capture Recall (`/chrome/v1/recall`) — page captures only, not
 * `/v1` project memory (that lives under Saved → Project memory). P1 dual-funnel.
 *
 * `tablist` semantics rather than links: this switches panes in place, and a
 * reader should hear "tab 2 of 4", not "link". Arrow keys move one step;
 * Home / End jump to the first / last tab (APG).
 */
export function NavRail({
  active,
  onSelect,
}: {
  active: TabId;
  onSelect: (id: TabId) => void;
}) {
  return (
    <nav className="wc-rail" role="tablist" aria-label="WalkCroach sections">
      {TABS.map(({ id, label, Icon }) => {
        const selected = active === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`wc-tab-${id}`}
            aria-selected={selected}
            aria-controls={`wc-pane-${id}`}
            aria-label={label}
            aria-current={selected ? 'page' : undefined}
            tabIndex={selected ? 0 : -1}
            className="wc-rail__item"
            onClick={() => onSelect(id)}
            onKeyDown={(e) => {
              const i = TABS.findIndex((t) => t.id === active);
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                onSelect(TABS[(i + 1) % TABS.length]!.id);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                onSelect(TABS[(i - 1 + TABS.length) % TABS.length]!.id);
              } else if (e.key === 'Home') {
                e.preventDefault();
                onSelect(TABS[0]!.id);
              } else if (e.key === 'End') {
                e.preventDefault();
                onSelect(TABS[TABS.length - 1]!.id);
              }
            }}
          >
            <Icon className="wc-rail__icon" />
            <span className="wc-rail__label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
