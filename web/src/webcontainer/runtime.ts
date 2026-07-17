import { WebContainer, type WebContainerProcess } from '@webcontainer/api';
import { getApiUrl } from '../api/client';
import { templateTree } from '../templates/template';

let bootPromise: Promise<WebContainer> | null = null;
let previewStarted = false;
let mountedKey: string | null = null;

export function bootWebContainer(): Promise<WebContainer> {
  if (!bootPromise) {
    bootPromise = WebContainer.boot();
  }
  return bootPromise;
}

export async function mountProjectWorkspace(
  wc: WebContainer,
  projectId: string,
  projectName: string,
  templateId: string | null | undefined,
): Promise<void> {
  const key = `${projectId}:${templateId ?? 'blank'}`;
  if (mountedKey === key) return;
  await wc.mount(templateTree(templateId, projectName));
  await writeProjectEnv(wc, projectId);
  mountedKey = key;
  previewStarted = false;
}

function readAuthToken(): string {
  try {
    const raw = localStorage.getItem('walkcroach.auth.v1');
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { token?: string };
    return parsed.token ?? '';
  } catch {
    return '';
  }
}

export async function writeProjectEnv(
  wc: WebContainer,
  projectId: string,
): Promise<void> {
  const apiUrl = getApiUrl();
  const token = readAuthToken();
  const lines = [
    `VITE_WALKCROACH_PROXY=${apiUrl}/proxy/${projectId}`,
    token ? `VITE_WALKCROACH_TOKEN=${token}` : '',
  ].filter(Boolean);
  await writeFile(wc, '.env.local', `${lines.join('\n')}\n`);
}

export async function ensureDir(
  wc: WebContainer,
  filePath: string,
): Promise<void> {
  const parts = filePath.split('/').filter(Boolean);
  parts.pop();
  let cur = '';
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    try {
      await wc.fs.mkdir(cur);
    } catch {
      /* exists */
    }
  }
}

export async function writeFile(
  wc: WebContainer,
  path: string,
  content: string,
): Promise<void> {
  const clean = path.replace(/^\.\//, '');
  await ensureDir(wc, clean);
  await wc.fs.writeFile(clean, content);
}

export async function editFile(
  wc: WebContainer,
  path: string,
  oldStr: string,
  newStr: string,
): Promise<void> {
  const clean = path.replace(/^\.\//, '');
  const current = await wc.fs.readFile(clean, 'utf-8');
  if (!current.includes(oldStr)) {
    throw new Error(`edit_file: old_str not found in ${clean}`);
  }
  await wc.fs.writeFile(clean, current.replace(oldStr, newStr));
}

async function readProcessOutput(
  proc: WebContainerProcess,
): Promise<{ stdout: string; exitCode: number }> {
  const chunks: string[] = [];
  await proc.output.pipeTo(
    new WritableStream({
      write(data) {
        chunks.push(data);
      },
    }),
  );
  const exitCode = await proc.exit;
  return { stdout: chunks.join(''), exitCode };
}

/** Split a shell-ish command into spawn(cmd, args). */
export function parseCmd(cmd: string): { command: string; args: string[] } {
  const trimmed = cmd.trim();
  const parts = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((p) =>
    p.replace(/^"|"$/g, ''),
  ) ?? [trimmed];
  return { command: parts[0] ?? 'echo', args: parts.slice(1) };
}

export async function runTerminal(
  wc: WebContainer,
  cmd: string,
): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string }> {
  if (/\bnpm\s+run\s+dev\b/.test(cmd) || /\bvite\b/.test(cmd)) {
    return {
      ok: true,
      exitCode: 0,
      stdout:
        'Skipped starting the preview from the agent — WalkCroach keeps Vite running in the preview pane.\n',
      stderr: '',
    };
  }

  const { command, args } = parseCmd(cmd);
  const proc = await wc.spawn(command, args);
  const { stdout, exitCode } = await readProcessOutput(proc);
  return {
    ok: exitCode === 0,
    exitCode,
    stdout,
    stderr: '',
  };
}

export async function startPreview(
  wc: WebContainer,
  onReady: (url: string) => void,
  onLog: (line: string) => void,
): Promise<void> {
  if (previewStarted) return;
  previewStarted = true;

  onLog('$ npm install');
  const install = await wc.spawn('npm', ['install']);
  install.output.pipeTo(
    new WritableStream({
      write(data) {
        onLog(data);
      },
    }),
  );
  const code = await install.exit;
  if (code !== 0) {
    previewStarted = false;
    throw new Error(`npm install failed (exit ${code})`);
  }

  wc.on('server-ready', (_port, url) => {
    onReady(url);
  });

  onLog('$ npm run dev');
  const dev = await wc.spawn('npm', ['run', 'dev']);
  dev.output.pipeTo(
    new WritableStream({
      write(data) {
        onLog(data);
      },
    }),
  );
}
