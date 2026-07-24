import { useContext } from 'react';
import { ShellContext, type ShellContextValue } from './shell-context';

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) {
    return {
      expanded: true,
      setExpanded: () => undefined,
      toggle: () => undefined,
    };
  }
  return ctx;
}
