import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createProjectSandbox,
  editSandboxFile,
  getSandboxPreview,
  listSandboxFiles,
  readSandboxFile,
  runSandboxTerminal,
  writeSandboxFile,
} from '../api/sandbox';
import { preferredSandboxRuntime } from '../sandbox/types';
import type { ProjectFile } from '../webcontainer/files';
import { useWebContainer, type WcBootPhase, type WcStatus } from './useWebContainer';

export type BuilderRuntimeKind = 'e2b' | 'webcontainer';

/**
 * Prefers E2B cloud sandbox; falls back to WebContainer when E2B is unavailable.
 */
export function useBuilderSandbox(
  projectId: string,
  projectName: string,
  templateId: string | null | undefined,
  onFilesMutated?: () => void,
) {
  const preferE2b = preferredSandboxRuntime() === 'e2b';
  const [fallback, setFallback] = useState(!preferE2b);
  const [e2bStatus, setE2bStatus] = useState<WcStatus>('idle');
  const [e2bPhase, setE2bPhase] = useState<WcBootPhase>('container');
  const [e2bError, setE2bError] = useState<string | null>(null);
  const [e2bPreviewUrl, setE2bPreviewUrl] = useState<string | null>(null);
  const [e2bLogs, setE2bLogs] = useState<string[]>([]);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const onMutateRef = useRef(onFilesMutated);
  onMutateRef.current = onFilesMutated;

  const wcEnabled = fallback;
  const wc = useWebContainer(
    projectId,
    projectName,
    templateId,
    onFilesMutated,
    wcEnabled,
  );

  const appendLog = useCallback((line: string) => {
    setE2bLogs((prev) => [...prev.slice(-400), line]);
  }, []);

  const bumpFiles = useCallback(() => {
    onMutateRef.current?.();
  }, []);

  const enqueue = useCallback(
    (fn: () => Promise<void>) => {
      const next = queueRef.current.then(fn);
      // Keep the queue alive after failures, but let callers observe rejection.
      queueRef.current = next.catch((err) => {
        appendLog(
          `action error: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      return next;
    },
    [appendLog],
  );

  useEffect(() => {
    if (!preferE2b || fallback) return;
    let cancelled = false;
    setE2bStatus('booting');
    setE2bPhase('container');
    setE2bError(null);
    setE2bPreviewUrl(null);

    (async () => {
      try {
        setE2bPhase('mount');
        appendLog('Starting E2B cloud sandbox…');
        const info = await createProjectSandbox(projectId, templateId);
        if (cancelled) return;
        setE2bPhase('preview');
        let preview = info.previewUrl;
        if (!preview) {
          try {
            const p = await getSandboxPreview(projectId);
            preview = p.url;
          } catch {
            /* optional */
          }
        }
        setE2bPreviewUrl(preview);
        appendLog(
          preview
            ? `Preview · ${preview}`
            : 'Sandbox ready (preview URL pending)',
        );
        setE2bPhase('ready');
        setE2bStatus('ready');
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        appendLog(`E2B unavailable — using local preview. ${message}`);
        setFallback(true);
        setE2bStatus('idle');
        setE2bError(null);
      }
    })();

    return () => {
      cancelled = true;
      // Keep E2B sandbox alive across remounts — identity is durable in DB.
      // Explicit DELETE /sandbox kills it.
    };
  }, [preferE2b, fallback, projectId, templateId, appendLog]);

  const e2bReady = preferE2b && !fallback && e2bStatus === 'ready';

  const listFiles = useCallback(async (): Promise<ProjectFile[]> => {
    if (e2bReady) return listSandboxFiles(projectId);
    return wc.listFiles();
  }, [e2bReady, projectId, wc]);

  const applySnapshot = useCallback(
    (files: ProjectFile[]) => {
      if (e2bReady) {
        return enqueue(async () => {
          appendLog(`revert ${files.length} files`);
          for (const f of files) {
            await writeSandboxFile(projectId, f.path, f.content);
          }
          bumpFiles();
        });
      }
      return wc.applySnapshot(files);
    },
    [e2bReady, enqueue, appendLog, projectId, bumpFiles, wc],
  );

  const applyWriteFile = useCallback(
    (path: string, content: string) => {
      if (e2bReady) {
        return enqueue(async () => {
          appendLog(`write_file ${path}`);
          await writeSandboxFile(projectId, path, content);
          bumpFiles();
        });
      }
      return wc.applyWriteFile(path, content);
    },
    [e2bReady, enqueue, appendLog, projectId, bumpFiles, wc],
  );

  const applyEditFile = useCallback(
    (path: string, oldStr: string, newStr: string) => {
      if (e2bReady) {
        return enqueue(async () => {
          appendLog(`edit_file ${path}`);
          await editSandboxFile(projectId, path, oldStr, newStr);
          bumpFiles();
        });
      }
      return wc.applyEditFile(path, oldStr, newStr);
    },
    [e2bReady, enqueue, appendLog, projectId, bumpFiles, wc],
  );

  const applyTerminal = useCallback(
    async (cmd: string) => {
      if (e2bReady) {
        appendLog(`$ ${cmd}`);
        const result = await runSandboxTerminal(projectId, cmd);
        if (result.stdout) appendLog(result.stdout);
        if (result.stderr) appendLog(result.stderr);
        return result;
      }
      return wc.applyTerminal(cmd);
    },
    [e2bReady, appendLog, projectId, wc],
  );

  const readFile = useCallback(
    async (path: string) => {
      if (e2bReady) {
        const file = await readSandboxFile(projectId, path);
        return file.content;
      }
      const clean = path.replace(/^\.\//, '');
      const files = await wc.listFiles();
      const hit = files.find(
        (f) => f.path === clean || f.path.endsWith(clean) || clean.endsWith(f.path),
      );
      if (!hit) throw new Error(`File not found: ${path}`);
      return hit.content;
    },
    [e2bReady, projectId, wc],
  );

  if (fallback) {
    return {
      runtime: 'webcontainer' as const,
      status: wc.status,
      bootPhase: wc.bootPhase,
      error: wc.error,
      previewUrl: wc.previewUrl,
      logs: wc.logs,
      listFiles: wc.listFiles,
      applySnapshot: wc.applySnapshot,
      applyWriteFile: wc.applyWriteFile,
      applyEditFile: wc.applyEditFile,
      applyTerminal: wc.applyTerminal,
      readFile,
    };
  }

  return {
    runtime: 'e2b' as const,
    status: e2bStatus,
    bootPhase: e2bPhase,
    error: e2bError,
    previewUrl: e2bPreviewUrl,
    logs: e2bLogs,
    listFiles,
    applySnapshot,
    applyWriteFile,
    applyEditFile,
    applyTerminal,
    readFile,
  };
}
