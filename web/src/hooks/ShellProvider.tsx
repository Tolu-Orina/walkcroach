import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { SHELL_EXPANDED_KEY, ShellContext } from './shell-context';

function readInitialExpanded(): boolean {
  try {
    const raw = localStorage.getItem(SHELL_EXPANDED_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    return window.matchMedia('(min-width: 768px)').matches;
  }
  return true;
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpandedState] = useState(readInitialExpanded);

  const setExpanded = useCallback((next: boolean) => {
    setExpandedState(next);
    try {
      localStorage.setItem(SHELL_EXPANDED_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    setExpandedState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SHELL_EXPANDED_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const value = useMemo(
    () => ({ expanded, setExpanded, toggle }),
    [expanded, setExpanded, toggle],
  );

  return (
    <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
  );
}
