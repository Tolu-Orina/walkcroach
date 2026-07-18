import type { WebContainer } from '@webcontainer/api';
import { filePathFromWcPath } from './types';

export async function readProjectFile(
  wc: WebContainer,
  path: string,
): Promise<string> {
  const clean = path.replace(/^\.\//, '');
  return wc.fs.readFile(clean, 'utf-8');
}

export async function applyInlineTextEdit(
  wc: WebContainer,
  wcPath: string,
  oldText: string,
  newText: string,
): Promise<void> {
  const filePath = filePathFromWcPath(wcPath);
  const clean = filePath.replace(/^\.\//, '');
  const current = await wc.fs.readFile(clean, 'utf-8');
  if (!current.includes(oldText)) {
    throw new Error(`Text not found in ${clean}`);
  }
  const occurrences = current.split(oldText).length - 1;
  if (occurrences > 1) {
    throw new Error(
      `Selected text appears ${occurrences} times in ${clean}; refine the selection so it is unique`,
    );
  }
  await wc.fs.writeFile(clean, current.replace(oldText, newText));
}
