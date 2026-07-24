import { createContext } from 'react';

export type ShellContextValue = {
  expanded: boolean;
  setExpanded: (next: boolean) => void;
  toggle: () => void;
};

export const ShellContext = createContext<ShellContextValue | null>(null);

export const SHELL_EXPANDED_KEY = 'walkcroach.shell.railExpanded.v1';
