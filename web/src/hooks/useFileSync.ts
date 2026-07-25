import { useCallback, useEffect, useRef } from 'react';
import { syncProjectFiles } from '../api/client';
import type { ProjectFile } from '../webcontainer/files';

const DEBOUNCE_MS = 2000;

export function useFileSync(
  projectId: string,
  listFiles: () => Promise<ProjectFile[]>,
  enabled: boolean,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Shared in-flight sync — callers await this instead of getting []. */
  const inflightRef = useRef<Promise<ProjectFile[]> | null>(null);

  const syncNow = useCallback(async (): Promise<ProjectFile[]> => {
    if (!enabled) return [];
    if (inflightRef.current) return inflightRef.current;

    const run = (async (): Promise<ProjectFile[]> => {
      try {
        const files = await listFiles();
        if (files.length > 0) {
          await syncProjectFiles(projectId, files);
        }
        return files;
      } finally {
        inflightRef.current = null;
      }
    })();

    inflightRef.current = run;
    return run;
  }, [projectId, listFiles, enabled]);

  const scheduleSync = useCallback(() => {
    if (!enabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void syncNow();
    }, DEBOUNCE_MS);
  }, [enabled, syncNow]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { scheduleSync, syncNow };
}
