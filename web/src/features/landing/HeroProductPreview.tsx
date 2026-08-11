import { useState } from 'react';
import { clsx } from 'clsx';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

const TABS = [
  { id: 'web', label: 'Web' },
  { id: 'extension', label: 'Extension' },
  { id: 'ide', label: 'IDE Ext' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * Product-first hero visual: real UI chrome, not abstract 3D.
 * Surface tabs make the multi-surface claim visible in the first viewport
 * (Evil Martians: switchable product UI for multi-use-case tools).
 */
export function HeroProductPreview() {
  const [tab, setTab] = useState<TabId>('web');
  const reduce = useReducedMotion();

  return (
    <div className="overflow-hidden rounded-[var(--lp-radius)] border border-[var(--lp-line)] bg-[var(--lp-panel)] shadow-[var(--lp-shadow)]">
      <div className="flex items-center gap-2 border-b border-[var(--lp-line)] bg-[var(--lp-canvas)] px-3 py-2 sm:px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-[#f07167]/80" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-[#f0b429]/80" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-[#c7e54a]/90" aria-hidden />
        <div
          className="ml-2 flex min-w-0 flex-1 gap-0.5 overflow-x-auto"
          role="tablist"
          aria-label="Product surfaces"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                'interactive shrink-0 rounded-[var(--lp-radius-control)] px-2.5 py-1.5',
                'font-sans text-xs font-bold transition',
                tab === t.id
                  ? 'bg-[var(--lp-accent-soft)] text-[var(--lp-accent)]'
                  : 'text-[var(--lp-muted)] hover:text-[var(--lp-ink)]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="hidden shrink-0 font-mono text-[10px] font-semibold text-[var(--lp-muted)] sm:inline">
          shared memory
        </span>
      </div>

      <div className="relative aspect-[16/10] overflow-hidden bg-[var(--lp-canvas)]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            role="tabpanel"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 p-3 sm:p-4"
          >
            {tab === 'web' && <WebPreview />}
            {tab === 'extension' && <ExtensionPreview />}
            {tab === 'ide' && <IdePreview />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function WebPreview() {
  return (
    <div className="flex h-full gap-3">
      <aside className="hidden w-[28%] flex-col gap-2 rounded-[var(--lp-radius-control)] border border-[var(--lp-line)] bg-[var(--lp-panel)] p-2.5 sm:flex">
        <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--lp-muted)]">
          Projects
        </p>
        {['Acme onboarding', 'Billing agents', 'Docs crawler'].map((name, i) => (
          <div
            key={name}
            className={clsx(
              'rounded-[var(--lp-radius-control)] px-2 py-1.5 text-xs font-semibold',
              i === 0
                ? 'bg-[var(--lp-accent-soft)] text-[var(--lp-accent)]'
                : 'text-[var(--lp-ink)]',
            )}
          >
            {name}
          </div>
        ))}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col rounded-[var(--lp-radius-control)] border border-[var(--lp-line)] bg-[var(--lp-panel)]">
        <div className="border-b border-[var(--lp-line)] px-3 py-2">
          <p className="text-xs font-bold text-[var(--lp-ink)]">Chat · Acme onboarding</p>
          <p className="text-[10px] font-medium text-[var(--lp-muted)]">
            Memory graph · 48 nodes linked
          </p>
        </div>
        <div className="flex flex-1 flex-col gap-2.5 overflow-hidden p-3">
          <Bubble side="user">
            Continue from the Chrome capture — what did we decide about SSO?
          </Bubble>
          <Bubble side="agent">
            From Extension memory: Okta as IdP, SCIM later. App Builder already has the auth
            route scaffolded in this project.
          </Bubble>
          <div className="mt-auto flex items-center gap-2 rounded-[var(--lp-radius-control)] border border-[var(--lp-line)] bg-[var(--lp-canvas)] px-2.5 py-2">
            <span className="flex-1 text-[11px] text-[var(--lp-muted)]">
              Ask with project memory…
            </span>
            <span className="rounded bg-[var(--lp-accent-bright)] px-2 py-0.5 text-[10px] font-bold text-[var(--lp-on-accent)]">
              Send
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExtensionPreview() {
  return (
    <div className="flex h-full justify-end">
      <div className="flex w-full max-w-sm flex-col rounded-[var(--lp-radius-control)] border border-[var(--lp-line)] bg-[var(--lp-panel)] shadow-[var(--lp-shadow)] sm:w-[70%]">
        <div className="flex items-center justify-between border-b border-[var(--lp-line)] px-3 py-2">
          <p className="text-xs font-bold text-[var(--lp-ink)]">WalkCroach · Side panel</p>
          <span className="rounded-full bg-[var(--lp-accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--lp-accent)]">
            Linked
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-2 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--lp-muted)]">
            Page context
          </p>
          <div className="rounded-[var(--lp-radius-control)] border border-[var(--lp-line)] bg-[var(--lp-canvas)] p-2.5">
            <p className="text-xs font-bold text-[var(--lp-ink)]">docs.acme.com/sso</p>
            <p className="mt-1 text-[11px] leading-snug text-[var(--lp-muted)]">
              Okta SAML · SCIM deferred · store decision in project memory
            </p>
          </div>
          <button
            type="button"
            className="mt-1 rounded-[var(--lp-radius-control)] bg-[var(--lp-accent-bright)] px-3 py-2 text-xs font-bold text-[var(--lp-on-accent)]"
          >
            Save to memory
          </button>
          <p className="text-[10px] text-[var(--lp-muted)]">
            Appears in Web Chat and IDE Extension for this project.
          </p>
        </div>
      </div>
    </div>
  );
}

function IdePreview() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[var(--lp-radius-control)] border border-[var(--lp-line)] bg-[#0b1220] text-[#e8eef3]">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className="text-[10px] font-bold text-white/50">auth.tsx</span>
        <span className="ml-auto rounded bg-[#c7e54a]/25 px-1.5 py-0.5 text-[10px] font-bold text-[#c7e54a]">
          WalkCroach
        </span>
      </div>
      <div className="flex flex-1 gap-0 font-mono text-[10px] leading-relaxed sm:text-[11px]">
        <div className="hidden w-8 shrink-0 select-none border-r border-white/10 py-2 text-right text-white/30 sm:block">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="pr-2">
              {i + 12}
            </div>
          ))}
        </div>
        <pre className="flex-1 overflow-hidden p-2 text-[#94a3b8]">
          <code>
            <span className="text-[#c7e54a]">// remembered from Web + Extension</span>
            {'\n'}
            const idp = <span className="text-[#fde68a]">&quot;okta&quot;</span>;
            {'\n'}
            const strategy = <span className="text-[#fde68a]">&quot;saml&quot;</span>;
            {'\n\n'}
            <span className="bg-[#c7e54a]/35 text-[#0b1220]">
              {'  '}
              // WalkCroach: continue SSO scaffold
            </span>
            {'\n'}
            export function AuthRoute() {'{'}
            {'\n'}
            {'  '}return &lt;SamlProvider idp={'{'}idp{'}'} /&gt;;
            {'\n'}
            {'}'}
          </code>
        </pre>
      </div>
      <div className="border-t border-white/10 bg-black/30 px-3 py-2 text-[10px] text-[#94a3b8]">
        Memory · Acme onboarding · same graph as Web
      </div>
    </div>
  );
}

function Bubble({
  side,
  children,
}: {
  side: 'user' | 'agent';
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        'max-w-[92%] rounded-[var(--lp-radius-control)] px-2.5 py-2 text-[11px] leading-snug sm:text-xs',
        side === 'user'
          ? 'ml-auto bg-[var(--lp-accent-bright)] font-medium text-[var(--lp-on-accent)]'
          : 'bg-[var(--lp-canvas)] font-medium text-[var(--lp-ink)] ring-1 ring-[var(--lp-line)]',
      )}
    >
      {children}
    </div>
  );
}
