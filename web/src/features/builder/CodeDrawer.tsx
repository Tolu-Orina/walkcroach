import { useCallback, useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { ProjectFile } from '../../webcontainer/files';

type CodeDrawerProps = {
  open: boolean;
  onClose: () => void;
  listFiles: () => Promise<ProjectFile[]>;
  onSave: (path: string, content: string) => void | Promise<void>;
  refreshKey?: number;
  ready: boolean;
  /** Fill the preview canvas instead of a bottom drawer. */
  fill?: boolean;
};

function languageForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    css: 'css',
    html: 'html',
    md: 'markdown',
    svg: 'xml',
    yml: 'yaml',
    yaml: 'yaml',
  };
  return map[ext] ?? 'plaintext';
}

function buildTree(paths: string[]): Map<string, string[]> {
  const roots = new Map<string, string[]>();
  for (const path of paths) {
    const parts = path.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    const list = roots.get(dir) ?? [];
    list.push(path);
    roots.set(dir, list);
  }
  return roots;
}

/**
 * File tree + Monaco — fills the preview canvas when Files mode is active.
 */
export function CodeDrawer({
  open,
  onClose,
  listFiles,
  onSave,
  refreshKey = 0,
  ready,
  fill = false,
}: CodeDrawerProps) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const next = await listFiles();
      setFiles(next);
      setActivePath((prev) => {
        if (prev && next.some((f) => f.path === prev)) return prev;
        return next[0]?.path ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [listFiles, ready]);

  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload, refreshKey]);

  useEffect(() => {
    if (!activePath) {
      setDraft('');
      setDirty(false);
      return;
    }
    const file = files.find((f) => f.path === activePath);
    setDraft(file?.content ?? '');
    setDirty(false);
  }, [activePath, files]);

  const tree = useMemo(
    () => buildTree(files.map((f) => f.path).sort()),
    [files],
  );

  const save = async () => {
    if (!activePath || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(activePath, draft);
      setFiles((prev) =>
        prev.map((f) =>
          f.path === activePath ? { ...f, content: draft } : f,
        ),
      );
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className={
        fill
          ? 'flex min-h-0 flex-1 flex-col bg-panel/95'
          : 'flex h-[min(52vh,26rem)] shrink-0 flex-col border-t border-line bg-panel/95'
      }
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="truncate font-mono text-[11px] text-mist">
          {activePath ?? 'Files'}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading || !ready}
            className="btn-ghost text-[11px]"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving || !activePath}
            className="btn-primary px-3 py-1 text-[11px] disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {!fill && (
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost text-[11px]"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {!ready ? (
        <p className="p-4 text-sm text-mist">
          Preview is still starting — files will appear when ready.
        </p>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(9rem,14rem)_1fr]">
          <aside className="overflow-y-auto border-r border-line p-2">
            {loading && files.length === 0 && (
              <p className="px-1 text-[11px] text-mist">Loading files…</p>
            )}
            {!loading && files.length === 0 && (
              <p className="px-1 text-[11px] text-mist">No files yet</p>
            )}
            {[...tree.entries()].map(([dir, paths]) => (
              <div key={dir} className="mb-2">
                <p className="mb-0.5 truncate px-1 font-mono text-[10px] text-mist/70">
                  {dir === '.' ? '/' : dir}
                </p>
                <ul className="space-y-0.5">
                  {paths.map((path) => {
                    const name = path.split('/').pop() ?? path;
                    const active = path === activePath;
                    return (
                      <li key={path}>
                        <button
                          type="button"
                          onClick={() => setActivePath(path)}
                          className={`interactive w-full truncate rounded-[var(--radius-control)] px-1.5 py-1 text-left font-mono text-[11px] ${
                            active
                              ? 'bg-signal/15 text-signal'
                              : 'text-paper hover:bg-raised'
                          }`}
                        >
                          {name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </aside>

          <div className="relative min-h-0">
            {error && (
              <p className="absolute inset-x-0 top-0 z-10 bg-ember/15 px-3 py-1.5 text-[11px] text-ember">
                {error}
              </p>
            )}
            {activePath ? (
              <Editor
                height="100%"
                theme="vs-dark"
                path={activePath}
                language={languageForPath(activePath)}
                value={draft}
                onChange={(value) => {
                  setDraft(value ?? '');
                  setDirty(true);
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  automaticLayout: true,
                  tabSize: 2,
                }}
              />
            ) : (
              <p className="grid h-full place-items-center text-sm text-mist">
                Select a file
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
