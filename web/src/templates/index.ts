import type { TemplateDefinition } from './scaffold';
import { safeProjectSlug, viteScaffold } from './scaffold';

const blankApp = (name: string) => `export default function App() {
  return (
    <main className="min-h-screen grid place-items-center bg-stone-100 text-stone-800 p-8">
      <div className="max-w-xl space-y-3">
        <p className="text-sm uppercase tracking-[0.2em] text-stone-500">${safeProjectSlug(name)}</p>
        <h1 className="text-3xl font-semibold" data-wc-path="src/App.tsx:#title">Ready when you are</h1>
        <p className="text-stone-600" data-wc-path="src/App.tsx:#subtitle">
          Describe what to build in WalkCroach. Files land here in the WebContainer preview.
        </p>
      </div>
    </main>
  )
}
`;

const landingWaitlistApp = (name: string) => `export default function App() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto max-w-3xl px-6 py-24 text-center">
        <p className="text-xs uppercase tracking-[0.25em] text-emerald-400">${safeProjectSlug(name)}</p>
        <h1 className="mt-4 text-4xl font-bold" data-wc-path="src/App.tsx:#hero-title">Join the waitlist</h1>
        <p className="mt-4 text-slate-400" data-wc-path="src/App.tsx:#hero-subtitle">Early access for teams building memory-first apps.</p>
        <form className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <input className="rounded-md border border-slate-700 bg-slate-900 px-4 py-2" placeholder="you@company.com" />
          <button type="button" className="rounded-md bg-emerald-500 px-5 py-2 font-medium text-slate-950">Notify me</button>
        </form>
      </section>
    </main>
  )
}
`;

const saasMarketingApp = () => `export default function App() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="font-semibold">Acme SaaS</span>
        <button type="button" className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white">Start trial</button>
      </header>
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="text-5xl font-bold tracking-tight" data-wc-path="src/App.tsx:#hero-title">Ship faster with one workspace</h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-600" data-wc-path="src/App.tsx:#hero-subtitle">Collaboration, analytics, and automation in a single pane.</p>
      </section>
    </main>
  )
}
`;

const portfolioApp = (name: string) => `export default function App() {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900">
      <section className="mx-auto max-w-3xl px-6 py-20">
        <p className="text-sm text-zinc-500">Portfolio</p>
        <h1 className="mt-2 text-4xl font-bold" data-wc-path="src/App.tsx:#name">${safeProjectSlug(name)}</h1>
        <p className="mt-4 text-zinc-600" data-wc-path="src/App.tsx:#tagline">Product designer & front-end engineer.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {['Case study A', 'Case study B'].map((t) => (
            <article key={t} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="font-medium">{t}</h2>
              <p className="mt-2 text-sm text-zinc-500">Outcome-focused summary.</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
`;

const internalDashboardApp = () => `export default function App() {
  const metrics = [
    { label: 'Active users', value: '1,284' },
    { label: 'Error rate', value: '0.4%' },
    { label: 'P95 latency', value: '182ms' },
  ]
  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <h1 className="text-2xl font-semibold" data-wc-path="src/App.tsx:#title">Ops dashboard</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">{m.label}</p>
            <p className="mt-1 text-2xl font-bold">{m.value}</p>
          </div>
        ))}
      </div>
    </main>
  )
}
`;

const todoApp = () => `import { useState } from 'react'

type Todo = { id: number; text: string; done: boolean }

export default function App() {
  const [items, setItems] = useState<Todo[]>([
    { id: 1, text: 'Ship WalkCroach MVP', done: true },
    { id: 2, text: 'Add memory summary cards', done: false },
  ])
  const [draft, setDraft] = useState('')

  const add = () => {
    const text = draft.trim()
    if (!text) return
    setItems((prev) => [...prev, { id: Date.now(), text, done: false }])
    setDraft('')
  }

  return (
    <main className="min-h-screen bg-stone-50 p-8 text-stone-900">
      <div className="mx-auto max-w-md rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold" data-wc-path="src/App.tsx:#title">Todos</h1>
        <div className="mt-4 flex gap-2">
          <input className="flex-1 rounded border border-stone-300 px-3 py-2" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New task" />
          <button type="button" onClick={add} className="rounded bg-stone-900 px-3 py-2 text-white">Add</button>
        </div>
        <ul className="mt-4 space-y-2">
          {items.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={t.done} readOnly />
              <span className={t.done ? 'line-through text-stone-400' : ''}>{t.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
`;

const blogApp = () => `const posts = [
  { title: 'Memory-first UX', excerpt: 'Why recall beats re-prompting.' },
  { title: 'Plan before build', excerpt: 'Approvals reduce thrash.' },
]

export default function App() {
  return (
    <main className="min-h-screen bg-amber-50 text-stone-900">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-bold" data-wc-path="src/App.tsx:#title">Engineering notes</h1>
        <ul className="mt-8 space-y-6">
          {posts.map((p) => (
            <li key={p.title} className="border-b border-amber-200 pb-4">
              <h2 className="text-xl font-medium">{p.title}</h2>
              <p className="mt-1 text-stone-600">{p.excerpt}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
`;

const pricingFaqApp = () => `const tiers = [
  { name: 'Starter', price: '$0', blurb: 'For experiments' },
  { name: 'Pro', price: '$29', blurb: 'For shipping' },
]

export default function App() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <section className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="text-center text-4xl font-bold" data-wc-path="src/App.tsx:#title">Pricing</h1>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {tiers.map((t) => (
            <div key={t.name} className="rounded-xl border border-slate-200 p-6">
              <h2 className="text-lg font-semibold">{t.name}</h2>
              <p className="mt-2 text-3xl font-bold">{t.price}</p>
              <p className="mt-2 text-sm text-slate-500">{t.blurb}</p>
            </div>
          ))}
        </div>
        <h2 className="mt-16 text-2xl font-semibold">FAQ</h2>
        <dl className="mt-4 space-y-4 text-sm text-slate-600">
          <div><dt className="font-medium text-slate-900">Can I export code?</dt><dd className="mt-1">Yes — ZIP export is built in.</dd></div>
          <div><dt className="font-medium text-slate-900">Is memory per project?</dt><dd className="mt-1">Yes — scoped to your project in CockroachDB.</dd></div>
        </dl>
      </section>
    </main>
  )
}
`;

const adminCrudApp = () => `type Row = { id: number; name: string; status: string }

const rows: Row[] = [
  { id: 1, name: 'Northwind', status: 'Active' },
  { id: 2, name: 'Contoso', status: 'Paused' },
]

export default function App() {
  return (
    <main className="min-h-screen bg-slate-900 p-6 text-slate-100">
      <div className="mx-auto max-w-4xl">
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-semibold" data-wc-path="src/App.tsx:#title">Accounts</h1>
          <button type="button" className="rounded bg-emerald-500 px-3 py-1.5 text-sm text-slate-950">New</button>
        </header>
        <table className="mt-6 w-full text-left text-sm">
          <thead className="text-slate-400">
            <tr><th className="pb-2">ID</th><th className="pb-2">Name</th><th className="pb-2">Status</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-700">
                <td className="py-2">{r.id}</td>
                <td className="py-2">{r.name}</td>
                <td className="py-2">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
`;

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'blank',
    name: 'Blank canvas',
    description: 'Empty Vite + React starter — fastest path to a custom idea.',
    examplePrompts: [
      'Build a muted landing page with a contact CTA',
      'Add a dark mode toggle and persist the preference',
    ],
    buildTree: (name) => viteScaffold(name, blankApp(name)),
  },
  {
    id: 'landing-waitlist',
    name: 'Landing page (waitlist)',
    description: 'Hero, email capture, and launch CTA shell.',
    examplePrompts: ['Polish the waitlist form with validation', 'Add social proof logos below the hero'],
    buildTree: (name) => viteScaffold(name, landingWaitlistApp(name)),
  },
  {
    id: 'saas-marketing',
    name: 'SaaS marketing',
    description: 'Product marketing layout with hero and trial CTA.',
    examplePrompts: ['Add a three-column features section', 'Write concise copy for developer teams'],
    buildTree: (name) => viteScaffold(name, saasMarketingApp()),
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    description: 'Personal site with project grid.',
    examplePrompts: ['Add a contact section with links', 'Make case study cards clickable'],
    buildTree: (name) => viteScaffold(name, portfolioApp(name)),
  },
  {
    id: 'internal-dashboard',
    name: 'Internal dashboard',
    description: 'Metric cards for ops or admin views.',
    examplePrompts: ['Add a second row of charts placeholders', 'Use muted greens for positive metrics'],
    buildTree: (name) => viteScaffold(name, internalDashboardApp()),
  },
  {
    id: 'todo',
    name: 'Todo app',
    description: 'Validates the core user journey — list, add, complete.',
    examplePrompts: ['Make todos toggleable and persist in localStorage', 'Add filter tabs: All / Active / Done'],
    buildTree: (name) => viteScaffold(name, todoApp()),
  },
  {
    id: 'blog',
    name: 'Blog',
    description: 'Simple post list with title and excerpt.',
    examplePrompts: ['Add a post detail route', 'Style with serif headings'],
    buildTree: (name) => viteScaffold(name, blogApp()),
  },
  {
    id: 'pricing-faq',
    name: 'Pricing + FAQ',
    description: 'Two-tier pricing and FAQ block.',
    examplePrompts: ['Add an annual toggle with 20% discount', 'Expand FAQ with billing questions'],
    buildTree: (name) => viteScaffold(name, pricingFaqApp()),
  },
  {
    id: 'admin-crud',
    name: 'Admin table CRUD',
    description: 'Table shell for back-office data.',
    examplePrompts: ['Wire row actions: edit and delete', 'Add search filter above the table'],
    buildTree: (name) => viteScaffold(name, adminCrudApp()),
  },
];

export const DEFAULT_TEMPLATE_ID = 'blank';

export function getTemplate(id: string | null | undefined): TemplateDefinition {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]!;
}
