import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebContainer } from '@webcontainer/api';
import {
  bootWebContainer,
  editFile,
  mountStarter,
  runTerminal,
  startPreview,
  writeFile,
} from '../webcontainer/runtime';

export type WcStatus = 'idle' | 'booting' | 'ready' | 'error';

let previewStarted = false;

export function useWebContainer(projectName: string) {
  const [status, setStatus] = useState<WcStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const wcRef = useRef<WebContainer | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const appendLog = useCallback((line: string) => {
    setLogs((prev) => [...prev.slice(-400), line]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus('booting');
    setError(null);

    (async () => {
      try {
        if (!crossOriginIsolated) {
          throw new Error(
            'Page is not cross-origin isolated. COOP/COEP headers are required for WebContainer.',
          );
        }
        const wc = await bootWebContainer();
        if (cancelled) return;
        wcRef.current = wc;

        if (!previewStarted) {
          previewStarted = true;
          await mountStarter(wc, projectName);
          await startPreview(
            wc,
            (url) => {
              if (!cancelled) setPreviewUrl(url);
            },
            (line) => {
              if (!cancelled) appendLog(line);
            },
          );
        }

        if (!cancelled) setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectName, appendLog]);

  const enqueue = useCallback(
    (fn: () => Promise<void>) => {
      queueRef.current = queueRef.current.then(fn).catch((err) => {
        appendLog(
          `action error: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      return queueRef.current;
    },
    [appendLog],
  );

  const applyWriteFile = useCallback(
    (path: string, content: string) =>
      enqueue(async () => {
        const wc = wcRef.current;
        if (!wc) throw new Error('WebContainer not ready');
        appendLog(`write_file ${path}`);
        await writeFile(wc, path, content);
      }),
    [enqueue, appendLog],
  );

  const applyEditFile = useCallback(
    (path: string, oldStr: string, newStr: string) =>
      enqueue(async () => {
        const wc = wcRef.current;
        if (!wc) throw new Error('WebContainer not ready');
        appendLog(`edit_file ${path}`);
        await editFile(wc, path, oldStr, newStr);
      }),
    [enqueue, appendLog],
  );

  const applyTerminal = useCallback(
    async (cmd: string) => {
      const wc = wcRef.current;
      if (!wc) throw new Error('WebContainer not ready');
      appendLog(`$ ${cmd}`);
      const result = await runTerminal(wc, cmd);
      if (result.stdout) appendLog(result.stdout);
      return result;
    },
    [appendLog],
  );

  return {
    status,
    error,
    previewUrl,
    logs,
    applyWriteFile,
    applyEditFile,
    applyTerminal,
  };
}
