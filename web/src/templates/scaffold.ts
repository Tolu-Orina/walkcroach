import type { FileSystemTree } from '@webcontainer/api';

export type TemplateDefinition = {
  id: string;
  name: string;
  description: string;
  examplePrompts: string[];
  buildTree: (projectName: string) => FileSystemTree;
};

export function safeProjectSlug(projectName: string): string {
  return projectName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'app';
}

export function viteScaffold(
  projectName: string,
  appTsx: string,
  indexCss = '@import "tailwindcss";\n',
): FileSystemTree {
  const safe = safeProjectSlug(projectName);
  const pkgName = safe.toLowerCase().replace(/\s+/g, '-');

  return {
    'package.json': {
      file: {
        contents: JSON.stringify(
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
      },
    },
    'vite.config.ts': {
      file: {
        contents: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, port: 5173 },
})
`,
      },
    },
    'tsconfig.json': {
      file: {
        contents: JSON.stringify(
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
      },
    },
    'index.html': {
      file: {
        contents: `<!doctype html>
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
      },
    },
    src: {
      directory: {
        'main.tsx': {
          file: {
            contents: `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initWcBridge } from './wc-bridge'

initWcBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,
          },
        },
        'wc-bridge.ts': {
          file: {
            contents: `let editMode = false
let highlightEl: HTMLElement | null = null

const HIGHLIGHT_STYLE = 'outline: 2px solid #38bdf8; outline-offset: 2px; cursor: crosshair;'

export function initWcBridge() {
  if (!import.meta.env.DEV) return

  window.addEventListener('message', (ev) => {
    const data = ev.data
    if (!data || typeof data !== 'object') return
    if (data.type === 'wc:set-edit-mode') {
      editMode = Boolean(data.enabled)
      if (!editMode && highlightEl) {
        highlightEl.style.cssText = highlightEl.style.cssText.replace(HIGHLIGHT_STYLE, '')
        highlightEl = null
      }
    }
    if (data.type === 'wc:highlight' && typeof data.path === 'string') {
      const el = document.querySelector(\`[data-wc-path="\${data.path}"]\`)
      if (el instanceof HTMLElement) {
        if (highlightEl) highlightEl.style.cssText = highlightEl.style.cssText.replace(HIGHLIGHT_STYLE, '')
        highlightEl = el
        el.style.cssText += HIGHLIGHT_STYLE
      }
    }
  })

  document.addEventListener(
    'click',
    (ev) => {
      if (!editMode) return
      const target = ev.target
      if (!(target instanceof HTMLElement)) return
      const el = target.closest('[data-wc-path]')
      if (!(el instanceof HTMLElement)) return
      ev.preventDefault()
      ev.stopPropagation()
      const path = el.getAttribute('data-wc-path') ?? ''
      window.parent.postMessage(
        {
          type: 'wc:element-selected',
          path,
          text: (el.textContent ?? '').trim(),
          tagName: el.tagName.toLowerCase(),
        },
        '*',
      )
    },
    true,
  )
}
`,
          },
        },
        lib: {
          directory: {
            'db.ts': {
              file: {
                contents: `const PROXY = import.meta.env.VITE_WALKCROACH_PROXY ?? ''
const TOKEN = import.meta.env.VITE_WALKCROACH_TOKEN ?? ''

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await fetch(\`\${PROXY}/sql\`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(TOKEN ? { authorization: \`Bearer \${TOKEN}\` } : {}),
    },
    body: JSON.stringify({ sql, params }),
  })
  if (!res.ok) throw new Error(await res.text())
  const data = (await res.json()) as { rows: T[] }
  return data.rows
}
`,
              },
            },
            'walkcroach.ts': {
              file: {
                contents: `const PROXY = import.meta.env.VITE_WALKCROACH_PROXY ?? ''
const TOKEN = import.meta.env.VITE_WALKCROACH_TOKEN ?? ''

export async function proxyFetch(
  url: string,
  init: RequestInit & { secretKey?: string; secretHeader?: string } = {},
): Promise<Response> {
  const { secretKey, secretHeader, ...rest } = init
  const res = await fetch(\`\${PROXY}/http\`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(TOKEN ? { authorization: \`Bearer \${TOKEN}\` } : {}),
    },
    body: JSON.stringify({
      url,
      method: rest.method ?? 'GET',
      headers: rest.headers,
      body: rest.body as string | undefined,
      secretKey,
      secretHeader,
    }),
  })
  if (!res.ok) throw new Error(await res.text())
  const data = (await res.json()) as {
    status: number
    body: string
    headers: Record<string, string>
  }
  return new Response(data.body, { status: data.status, headers: data.headers })
}
`,
              },
            },
          },
        },
        'App.tsx': {
          file: { contents: appTsx },
        },
        'index.css': {
          file: { contents: indexCss },
        },
      },
    },
  };
}
