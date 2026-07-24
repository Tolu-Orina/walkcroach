/**
 * Flat Vite+React template files for E2B mount (parity with web WebContainer scaffolds).
 * Returns path/content pairs — no @webcontainer/api dependency.
 */
import type { SandboxFileEntry } from './types.js';

function safeSlug(projectName: string): string {
  return projectName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'app';
}

function blankApp(name: string): string {
  const slug = safeSlug(name);
  return `export default function App() {
  return (
    <main className="min-h-screen grid place-items-center bg-stone-100 text-stone-800 p-8">
      <div className="max-w-xl space-y-3">
        <p className="text-sm uppercase tracking-[0.2em] text-stone-500">${slug}</p>
        <h1 className="text-3xl font-semibold" data-wc-path="src/App.tsx:#title">Ready when you are</h1>
        <p className="text-stone-600" data-wc-path="src/App.tsx:#subtitle">
          Describe what to build in WalkCroach. Files land here in the sandbox preview.
        </p>
      </div>
    </main>
  )
}
`;
}

function landingWaitlistApp(name: string): string {
  const slug = safeSlug(name);
  return `export default function App() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto max-w-3xl px-6 py-24 text-center">
        <p className="text-xs uppercase tracking-[0.25em] text-emerald-400">${slug}</p>
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
}

function todoApp(): string {
  return `import { useState } from 'react'

export default function App() {
  const [items, setItems] = useState(['Ship preview', 'Wire agent tools'])
  const [draft, setDraft] = useState('')
  return (
    <main className="min-h-screen bg-stone-50 p-8 text-stone-900">
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-2xl font-semibold" data-wc-path="src/App.tsx:#title">Todos</h1>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!draft.trim()) return
            setItems((prev) => [...prev, draft.trim()])
            setDraft('')
          }}
        >
          <input
            className="flex-1 rounded border border-stone-300 px-3 py-2"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a task"
          />
          <button type="submit" className="rounded bg-stone-900 px-3 py-2 text-white">Add</button>
        </form>
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item} className="rounded border border-stone-200 bg-white px-3 py-2">{item}</li>
          ))}
        </ul>
      </div>
    </main>
  )
}
`;
}

function appSourceForTemplate(templateId: string, projectName: string): string {
  switch (templateId) {
    case 'landing-waitlist':
      return landingWaitlistApp(projectName);
    case 'todo':
      return todoApp();
    default:
      return blankApp(projectName);
  }
}

/** Flat Vite + React + Tailwind scaffold for E2B writeFile mount. */
export function buildTemplateFiles(
  templateId: string | null | undefined,
  projectName: string,
): SandboxFileEntry[] {
  const id = templateId?.trim() || 'blank';
  const safe = safeSlug(projectName);
  const pkgName = safe.toLowerCase().replace(/\s+/g, '-');
  const appTsx = appSourceForTemplate(id, projectName);

  const files: Record<string, string> = {
    'package.json': JSON.stringify(
      {
        name: pkgName,
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite --host',
          build: 'vite build',
          preview: 'vite preview --host',
        },
        dependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
        },
        devDependencies: {
          '@tailwindcss/vite': '^4.1.0',
          '@types/react': '^19.0.0',
          '@types/react-dom': '^19.0.0',
          '@vitejs/plugin-react': '^4.4.0',
          tailwindcss: '^4.1.0',
          typescript: '~5.8.0',
          vite: '^6.2.0',
        },
      },
      null,
      2,
    ),
    'vite.config.ts': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, port: 5173 },
})
`,
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
          strict: true,
          skipLibCheck: true,
        },
        include: ['src'],
      },
      null,
      2,
    ),
    'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safe}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    'src/main.tsx': `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,
    'src/index.css': '@import "tailwindcss";\n',
    'src/App.tsx': appTsx,
  };

  return Object.entries(files).map(([path, content]) => ({ path, content }));
}
