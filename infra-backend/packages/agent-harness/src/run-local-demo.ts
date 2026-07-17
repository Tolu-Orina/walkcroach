/**
 * Local agent-loop demo with a real Vite preview.
 *
 * 1. Scaffold React+Vite+Tailwind workspace under results/<name>/workspace
 * 2. Run Bedrock agent loop (CRDB memory)
 * 3. Apply write_file/edit_file to disk; run npm install for real
 * 4. Start `npm run dev` and print the localhost URL
 *
 *   cd infra-backend && npm run local:demo
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createDbClient, type DbClient } from '@walkcroach/db';
import {
  continueAfterTool,
  runPromptTurn,
  writeMemoryEntry,
  type AgentEvent,
} from './index.js';

const execAsync = promisify(exec);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const ADJECTIVES = [
  'amber', 'brisk', 'calm', 'copper', 'crisp', 'dusk', 'ember', 'fern',
  'flint', 'haze', 'ivory', 'jade', 'keen', 'lunar', 'maple', 'north',
  'olive', 'pine', 'quiet', 'river', 'slate', 'steady', 'tide', 'umber',
  'violet', 'willow',
];
const NOUNS = [
  'anvil', 'beacon', 'cedar', 'compass', 'crane', 'forge', 'harbor',
  'hearth', 'kite', 'lantern', 'meadow', 'nexus', 'orchard', 'pebble',
  'quarry', 'ridge', 'sparrow', 'timber', 'valley', 'wharf',
];

function loadEnv(): void {
  const path = join(ROOT, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function pick<T>(arr: T[]): T {
  return arr[randomBytes(1)[0]! % arr.length]!;
}

function randomRunName(): string {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${randomBytes(2).toString('hex')}`;
}

function randomProjectName(): string {
  const adj = pick(ADJECTIVES);
  const noun = pick(NOUNS);
  return `${adj[0]!.toUpperCase()}${adj.slice(1)} ${noun[0]!.toUpperCase()}${noun.slice(1)} Co`;
}

type ToolCall = {
  id: string;
  tool: string;
  awaitResult?: boolean;
  args: Record<string, unknown>;
};

type TurnLog = {
  name: string;
  prompt?: string;
  events: AgentEvent[];
  assistantText: string;
  toolCalls: ToolCall[];
  doneReason?: string;
};

function collectFromEvents(
  events: AgentEvent[],
): Omit<TurnLog, 'name' | 'prompt'> {
  let assistantText = '';
  const toolCalls: ToolCall[] = [];
  let doneReason: string | undefined;
  for (const e of events) {
    if (e.type === 'token') assistantText += e.text;
    if (e.type === 'tool_call') {
      toolCalls.push({
        id: e.id,
        tool: e.tool,
        awaitResult: e.awaitResult,
        args: e.args,
      });
    }
    if (e.type === 'done') doneReason = e.reason;
  }
  return { events, assistantText, toolCalls, doneReason };
}

/** Minimal Vite + React + TS + Tailwind v4 workspace the agent edits. */
function scaffoldWorkspace(ws: string, projectName: string): void {
  mkdirSync(join(ws, 'src'), { recursive: true });

  writeFileSync(
    join(ws, 'package.json'),
    JSON.stringify(
      {
        name: projectName.toLowerCase().replace(/\s+/g, '-'),
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: {
          dev: 'vite --host 127.0.0.1 --port 5173',
          build: 'tsc -b && vite build',
          preview: 'vite preview',
        },
        dependencies: {
          react: '^19.1.0',
          'react-dom': '^19.1.0',
        },
        devDependencies: {
          '@tailwindcss/vite': '^4.1.0',
          '@types/react': '^19.1.0',
          '@types/react-dom': '^19.1.0',
          '@vitejs/plugin-react': '^4.4.0',
          tailwindcss: '^4.1.0',
          typescript: '~5.8.0',
          vite: '^6.3.0',
        },
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(ws, 'vite.config.ts'),
    `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
})
`,
  );

  writeFileSync(
    join(ws, 'tsconfig.json'),
    JSON.stringify(
      {
        files: [],
        references: [
          { path: './tsconfig.app.json' },
          { path: './tsconfig.node.json' },
        ],
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(ws, 'tsconfig.app.json'),
    JSON.stringify(
      {
        compilerOptions: {
          tsBuildInfoFile: './node_modules/.tmp/tsconfig.app.tsbuildinfo',
          target: 'ES2022',
          useDefineForClassFields: true,
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          verbatimModuleSyntax: true,
          moduleDetection: 'force',
          noEmit: true,
          jsx: 'react-jsx',
          strict: true,
          noUnusedLocals: false,
          noUnusedParameters: false,
          noFallthroughCasesInSwitch: true,
          noUncheckedSideEffectImports: true,
        },
        include: ['src'],
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(ws, 'tsconfig.node.json'),
    JSON.stringify(
      {
        compilerOptions: {
          tsBuildInfoFile: './node_modules/.tmp/tsconfig.node.tsbuildinfo',
          target: 'ES2023',
          lib: ['ES2023'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          verbatimModuleSyntax: true,
          moduleDetection: 'force',
          noEmit: true,
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noFallthroughCasesInSwitch: true,
          noUncheckedSideEffectImports: true,
        },
        include: ['vite.config.ts'],
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(ws, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  );

  writeFileSync(
    join(ws, 'src/main.tsx'),
    `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,
  );

  writeFileSync(
    join(ws, 'src/index.css'),
    `@import "tailwindcss";

body {
  margin: 0;
  min-height: 100vh;
  background: #f3f4f6;
  color: #1f2937;
  font-family: system-ui, sans-serif;
}
`,
  );

  writeFileSync(
    join(ws, 'src/App.tsx'),
    `export default function App() {
  return (
    <main className="min-h-screen p-8">
      <p className="text-gray-500">Waiting for WalkCroach agent output…</p>
    </main>
  )
}
`,
  );

  writeFileSync(
    join(ws, 'src/vite-env.d.ts'),
    `/// <reference types="vite/client" />
`,
  );
}

function applyFileTools(ws: string, toolCalls: ToolCall[]): string[] {
  const written: string[] = [];
  for (const tc of toolCalls) {
    if (tc.tool === 'write_file') {
      const rel = String(tc.args.path ?? '').replace(/^\/+/, '');
      if (!rel) continue;
      const dest = join(ws, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, String(tc.args.content ?? ''), 'utf8');
      written.push(rel);
    }
    if (tc.tool === 'edit_file') {
      const rel = String(tc.args.path ?? '').replace(/^\/+/, '');
      const dest = join(ws, rel);
      if (!existsSync(dest)) continue;
      const oldStr = String(tc.args.old_str ?? '');
      const newStr = String(tc.args.new_str ?? '');
      const prev = readFileSync(dest, 'utf8');
      writeFileSync(dest, prev.split(oldStr).join(newStr), 'utf8');
      written.push(rel);
    }
  }
  return written;
}

/** Ensure Tailwind v4 entry survives agent overwrites of index.css */
function ensureTailwindCss(ws: string): void {
  const cssPath = join(ws, 'src', 'index.css');
  if (!existsSync(cssPath)) return;
  let css = readFileSync(cssPath, 'utf8');
  if (!css.includes('@import "tailwindcss"') && !css.includes("@import 'tailwindcss'")) {
    css = `@import "tailwindcss";\n\n${css}`;
    writeFileSync(cssPath, css, 'utf8');
  }
}

/** Point App.tsx at generated Hero / ContactCTA if present. */
function wireAppEntry(ws: string, projectName: string): void {
  const src = join(ws, 'src');
  const files = existsSync(src) ? readdirSync(src) : [];
  const hasHero = files.includes('Hero.tsx');
  const hasCta = files.includes('ContactCTA.tsx');

  const imports: string[] = [];
  const body: string[] = [];
  if (hasHero) {
    imports.push(`import Hero from './Hero.tsx'`);
    body.push(`      <Hero />`);
  }
  if (hasCta) {
    imports.push(`import ContactCTA from './ContactCTA.tsx'`);
    body.push(`      <ContactCTA />`);
  }
  if (body.length === 0) {
    body.push(
      `      <p className="p-8 text-gray-600">${projectName} — no components generated yet.</p>`,
    );
  }

  writeFileSync(
    join(ws, 'src/App.tsx'),
    `${imports.join('\n')}${imports.length ? '\n\n' : ''}export default function App() {
  return (
    <main className="min-h-screen bg-gray-100">
${body.join('\n')}
    </main>
  )
}
`,
  );
}

async function runShell(
  ws: string,
  cmd: string,
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  // Refuse to let the agent hang us on a long-lived server — we start vite ourselves.
  if (/\bnpm\s+run\s+dev\b/.test(cmd) || /\bvite\b/.test(cmd)) {
    return {
      ok: true,
      exitCode: 0,
      stdout:
        'Skipped starting dev server from agent tool — WalkCroach will run `npm run dev` after the loop.\n',
      stderr: '',
    };
  }

  console.log(`\n$ (cwd=${ws}) ${cmd}`);
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: ws,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    return {
      ok: true,
      exitCode: 0,
      stdout: String(stdout ?? ''),
      stderr: String(stderr ?? ''),
    };
  } catch (err) {
    const e = err as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      ok: false,
      exitCode: typeof e.code === 'number' ? e.code : 1,
      stdout: String(e.stdout ?? ''),
      stderr: String(e.stderr ?? e.message ?? err),
    };
  }
}

async function drain(
  events: AsyncIterable<AgentEvent>,
  ndjsonPath: string,
): Promise<{ events: AgentEvent[]; lastDone?: AgentEvent }> {
  const collected: AgentEvent[] = [];
  let lastDone: AgentEvent | undefined;
  const lines: string[] = [];

  for await (const e of events) {
    collected.push(e);
    lines.push(JSON.stringify({ t: new Date().toISOString(), ...e }));
    if (e.type === 'token') process.stdout.write(e.text);
    else if (e.type === 'tool_call') {
      console.log(
        `\n[tool_call] ${e.tool} await=${e.awaitResult ?? false} id=${e.id}`,
      );
    } else if (e.type === 'memory_recalled') {
      console.log(`\n[memory_recalled] count=${e.count}`);
    } else if (e.type === 'error') {
      console.log(`\n[error] ${e.message}`);
    } else if (e.type === 'done') {
      console.log(`\n[done] ${e.reason}`);
      lastDone = e;
    }
  }

  writeFileSync(ndjsonPath, lines.join('\n') + (lines.length ? '\n' : ''), {
    flag: 'a',
  });
  return { events: collected, lastDone };
}

async function resumeShellTools(params: {
  db: DbClient;
  sessionId: string;
  projectId: string;
  workspace: string;
  events: AgentEvent[];
  lastDone?: AgentEvent;
  turns: TurnLog[];
  ndjsonPath: string;
  turnPrefix: string;
}): Promise<{ events: AgentEvent[]; lastDone?: AgentEvent }> {
  let { events, lastDone } = params;
  let guard = 0;
  while (
    lastDone?.type === 'done' &&
    lastDone.reason === 'awaiting_tool' &&
    guard < 6
  ) {
    guard += 1;
    const pendingCall = [...events]
      .reverse()
      .find((e) => e.type === 'tool_call' && e.awaitResult);
    if (!pendingCall || pendingCall.type !== 'tool_call') {
      throw new Error('awaiting_tool but no awaitResult tool_call');
    }

    const cmd =
      pendingCall.tool === 'run_terminal'
        ? String(pendingCall.args.cmd ?? '')
        : '';
    const shell = await runShell(params.workspace, cmd || 'echo ok');

    console.log(
      `\n=== ${params.turnPrefix}: real shell (${pendingCall.tool}) exit=${shell.exitCode} ===`,
    );

    ({ events, lastDone } = await drain(
      continueAfterTool({
        db: params.db,
        sessionId: params.sessionId,
        projectId: params.projectId,
        toolResult: {
          toolCallId: pendingCall.id,
          ok: shell.ok,
          exitCode: shell.exitCode,
          stdout: shell.stdout.slice(0, 8000),
          stderr: shell.stderr.slice(0, 4000),
        },
      }),
      params.ndjsonPath,
    ));

    const collected = collectFromEvents(events);
    applyFileTools(params.workspace, collected.toolCalls);
    params.turns.push({
      name: `${params.turnPrefix}-tool-result-${guard}`,
      ...collected,
    });
  }
  return { events, lastDone };
}

async function snapshotDb(
  db: DbClient,
  projectId: string,
  sessionId: string,
) {
  const messages = await db.query(
    `SELECT id, role, content, created_at FROM messages
     WHERE session_id = $1::uuid ORDER BY created_at`,
    [sessionId],
  );
  const buildEvents = await db.query(
    `SELECT id, tool_name, tool_args, result_summary, created_at FROM build_events
     WHERE session_id = $1::uuid ORDER BY created_at`,
    [sessionId],
  );
  const memories = await db.query(
    `SELECT id, kind, text, created_at FROM memory_entries
     WHERE project_id = $1::uuid ORDER BY created_at`,
    [projectId],
  );
  return {
    messages: messages.rows,
    build_events: buildEvents.rows,
    memory_entries: memories.rows,
  };
}

function startViteDev(ws: string): Promise<{ url: string; pid: number }> {
  return new Promise((resolvePromise, reject) => {
    // Keep attached so we can read the "Local:" URL from stdout (Windows-safe).
    const child = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], {
      cwd: ws,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let settled = false;
    const logPath = join(ws, '..', 'vite-dev.log');
    const chunks: string[] = [];

    const onData = (buf: Buffer) => {
      const text = buf.toString('utf8');
      chunks.push(text);
      writeFileSync(logPath, chunks.join(''), 'utf8');
      process.stdout.write(text);

      const match = text.match(/https?:\/\/(localhost|127\.0\.0\.1):\d+/);
      if (match && !settled) {
        settled = true;
        resolvePromise({ url: match[0], pid: child.pid ?? 0 });
      }
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (err) => {
      if (!settled) reject(err);
    });
    child.on('exit', (code) => {
      if (!settled) {
        reject(new Error(`vite exited early code=${code}\n${chunks.join('')}`));
      }
    });

    setTimeout(() => {
      if (!settled) {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        reject(
          new Error(
            `Timed out waiting for Vite URL. See ${logPath}\n${chunks.join('')}`,
          ),
        );
      }
    }, 90_000);
  });
}

async function main() {
  loadEnv();
  const runId = randomRunName();
  const projectName = randomProjectName();
  const outDir = join(ROOT, 'results', runId);
  const workspace = join(outDir, 'workspace');
  mkdirSync(workspace, { recursive: true });
  scaffoldWorkspace(workspace, projectName);

  const prompt =
    process.env.WALKCROACH_DEMO_PROMPT ??
    `Build a small landing hero for a trades business called "${projectName}".
Use muted tones and non-salesy copy (remember that as a preference if not already stored).
1) write_file src/Hero.tsx — a React+Tailwind hero section component (default export)
2) write_file src/index.css — keep @import "tailwindcss"; plus any minimal muted styles
3) run_terminal with cmd "npm install"

Keep files short and production-plausible. Do not start a dev server.`;

  const followUp =
    process.env.WALKCROACH_DEMO_FOLLOWUP ??
    `Continue from where we left off. Add a ContactCTA component in src/ContactCTA.tsx
(default export) with a short muted heading and a single email mailto link — still non-salesy.
Do not reinstall packages or start a dev server.`;

  const meta = {
    runId,
    projectName,
    startedAt: new Date().toISOString(),
    prompt,
    followUp,
    region: process.env.AWS_REGION,
    model: process.env.BEDROCK_NOVA_MODEL_ID,
  };
  writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
  writeFileSync(join(outDir, 'prompt.txt'), prompt);
  writeFileSync(join(outDir, 'followup.txt'), followUp);

  const ndjsonPath = join(outDir, 'events.ndjson');
  writeFileSync(ndjsonPath, '');
  const turns: TurnLog[] = [];
  const db = createDbClient();

  try {
    const { rows: projects } = await db.query<{ id: string }>(
      `INSERT INTO projects (owner_id, name, surface_origin, stack_config)
       VALUES ('local-demo', $1, 'web', '{"stack":"react-vite-tailwind"}'::jsonb)
       RETURNING id`,
      [projectName],
    );
    const projectId = projects[0]!.id;

    await writeMemoryEntry({
      db,
      projectId,
      sourceSurface: 'web',
      kind: 'preference',
      text: 'User prefers muted tones and non-salesy landing-page copy',
    });

    const { rows: sessions } = await db.query<{ id: string }>(
      `INSERT INTO sessions (project_id, model_config)
       VALUES ($1::uuid, '{"mode":"build"}'::jsonb)
       RETURNING id`,
      [projectId],
    );
    const sessionId = sessions[0]!.id;

    writeFileSync(
      join(outDir, 'ids.json'),
      JSON.stringify({ projectId, sessionId, projectName, runId }, null, 2),
    );

    console.log(`results → ${outDir}`);
    console.log('workspace', workspace);
    console.log('runId', runId);
    console.log('projectName', projectName);

    console.log('\n=== turn: initial prompt ===\n');
    let { events, lastDone } = await drain(
      runPromptTurn({
        db,
        sessionId,
        projectId,
        mode: 'build',
        message: prompt,
      }),
      ndjsonPath,
    );
    let collected = collectFromEvents(events);
    applyFileTools(workspace, collected.toolCalls);
    turns.push({ name: 'initial-prompt', prompt, ...collected });

    ({ events, lastDone } = await resumeShellTools({
      db,
      sessionId,
      projectId,
      workspace,
      events,
      lastDone,
      turns,
      ndjsonPath,
      turnPrefix: 'initial',
    }));

    if (!(lastDone?.type === 'done' && lastDone.reason === 'complete')) {
      throw new Error(`Initial turn incomplete: ${JSON.stringify(lastDone)}`);
    }

    console.log('\n=== turn: follow-up (same session) ===\n');
    ({ events, lastDone } = await drain(
      runPromptTurn({
        db,
        sessionId,
        projectId,
        mode: 'build',
        message: followUp,
      }),
      ndjsonPath,
    ));
    collected = collectFromEvents(events);
    applyFileTools(workspace, collected.toolCalls);
    turns.push({ name: 'follow-up', prompt: followUp, ...collected });

    ({ events, lastDone } = await resumeShellTools({
      db,
      sessionId,
      projectId,
      workspace,
      events,
      lastDone,
      turns,
      ndjsonPath,
      turnPrefix: 'followup',
    }));

    // Ensure deps exist even if model skipped npm install
    if (!existsSync(join(workspace, 'node_modules'))) {
      console.log('\nnode_modules missing — running npm install…');
      const install = await runShell(workspace, 'npm install');
      writeFileSync(
        join(outDir, 'npm-install.log'),
        install.stdout + '\n' + install.stderr,
      );
      if (!install.ok) {
        throw new Error(`npm install failed: ${install.stderr}`);
      }
    }

    wireAppEntry(workspace, projectName);
    ensureTailwindCss(workspace);

    const allToolCalls = turns.flatMap((t) => t.toolCalls);
    const dbSnap = await snapshotDb(db, projectId, sessionId);
    writeFileSync(join(outDir, 'db-snapshot.json'), JSON.stringify(dbSnap, null, 2));
    writeFileSync(join(outDir, 'turns.json'), JSON.stringify(turns, null, 2));

    const followUpEdited = turns
      .filter(
        (t) =>
          t.name.startsWith('follow-up') || t.name.startsWith('followup'),
      )
      .flatMap((t) => t.toolCalls)
      .some((c) => c.tool === 'write_file' || c.tool === 'edit_file');

    console.log('\n=== starting Vite (npm run dev) ===\n');
    const preview = await startViteDev(workspace);
    writeFileSync(join(outDir, 'preview-url.txt'), `${preview.url}\n`);
    writeFileSync(
      join(outDir, 'vite.pid'),
      String(preview.pid),
    );

    const summary = {
      ok:
        lastDone?.type === 'done' &&
        lastDone.reason === 'complete' &&
        followUpEdited,
      runId,
      projectName,
      outDir,
      workspace,
      previewUrl: preview.url,
      vitePid: preview.pid,
      projectId,
      sessionId,
      turns: turns.length,
      toolCalls: allToolCalls.map((t) => t.tool),
      followUpEdited,
      messageCount: dbSnap.messages.length,
      buildEventCount: dbSnap.build_events.length,
      memoryCount: dbSnap.memory_entries.length,
      finishedAt: new Date().toISOString(),
    };
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    writeFileSync(
      join(outDir, 'transcript.md'),
      [
        `# ${runId} — ${projectName}`,
        '',
        `**Preview:** ${preview.url}`,
        '',
        `Open that URL in your browser. Vite PID: ${preview.pid}`,
        '',
        'Stop with: `taskkill /PID ' + preview.pid + ' /F` (Windows) or `kill ' + preview.pid + '`',
        '',
      ].join('\n'),
    );

    writeFileSync(
      join(ROOT, 'results', 'LATEST.txt'),
      `${runId}\n${projectName}\n${preview.url}\n${outDir}\n`,
    );

    console.log('\n=== summary ===');
    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nOpen in browser: ${preview.url}\n`);

    // Best-effort open default browser (Windows / macOS / Linux)
    const openCmd =
      process.platform === 'win32'
        ? `start "" "${preview.url}"`
        : process.platform === 'darwin'
          ? `open "${preview.url}"`
          : `xdg-open "${preview.url}"`;
    try {
      await execAsync(openCmd);
    } catch {
      console.log('(Could not auto-open browser — open the URL manually.)');
    }

    if (!summary.ok) process.exitCode = 1;
    else console.log('\nlocal:demo OK — leave this process running to keep the preview up (Ctrl+C to stop)');

    const shutdown = () => {
      try {
        if (preview.pid) process.kill(preview.pid);
      } catch {
        /* ignore */
      }
      process.exit(process.exitCode ?? 0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep parent alive so the Vite child keeps serving.
    await new Promise(() => {});
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
