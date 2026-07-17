import type { FileSystemTree } from '@webcontainer/api';

/** Default Vite + React + Tailwind workspace mounted into WebContainer. */
export function defaultTemplate(projectName: string): FileSystemTree {
  const safe = projectName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'app';
  return {
    'package.json': {
      file: {
        contents: JSON.stringify(
          {
            name: safe.toLowerCase().replace(/\s+/g, '-'),
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,
          },
        },
        'App.tsx': {
          file: {
            contents: `export default function App() {
  return (
    <main className="min-h-screen grid place-items-center bg-stone-100 text-stone-800 p-8">
      <div className="max-w-xl space-y-3">
        <p className="text-sm uppercase tracking-[0.2em] text-stone-500">${safe}</p>
        <h1 className="text-3xl font-semibold">Ready when you are</h1>
        <p className="text-stone-600">
          Describe what to build in WalkCroach. Files land here in the WebContainer preview.
        </p>
      </div>
    </main>
  )
}
`,
          },
        },
        'index.css': {
          file: {
            contents: `@import "tailwindcss";
`,
          },
        },
      },
    },
  };
}
