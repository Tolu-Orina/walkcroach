import type { WebContainer } from '@webcontainer/api';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

export type ProjectFile = { path: string; content: string };

type DirEnt = { name: string; isDirectory: () => boolean };

export async function listProjectFiles(
  wc: WebContainer,
  dir = '.',
): Promise<ProjectFile[]> {
  const out: ProjectFile[] = [];
  let entries: DirEnt[];
  try {
    entries = (await wc.fs.readdir(dir, {
      withFileTypes: true,
    })) as DirEnt[];
  } catch {
    return out;
  }

  for (const entry of entries) {
    const path = dir === '.' ? entry.name : `${dir}/${entry.name}`;
    if (SKIP_DIRS.has(entry.name)) continue;

    if (entry.isDirectory()) {
      out.push(...(await listProjectFiles(wc, path)));
      continue;
    }

    try {
      const content = await wc.fs.readFile(path, 'utf-8');
      out.push({ path, content });
    } catch {
      /* skip unreadable files */
    }
  }

  return out;
}

export async function applyProjectFiles(
  wc: WebContainer,
  files: ProjectFile[],
): Promise<void> {
  for (const file of files) {
    const clean = file.path.replace(/^\.\//, '');
    const parts = clean.split('/').filter(Boolean);
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
    await wc.fs.writeFile(clean, file.content);
  }
}
