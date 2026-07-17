import type { FileSystemTree } from '@webcontainer/api';
import { getTemplate } from './index';

/** @deprecated Use getTemplate(id).buildTree(name) */
export { viteScaffold, safeProjectSlug } from './scaffold';
export type { TemplateDefinition } from './scaffold';

export function templateTree(
  templateId: string | null | undefined,
  projectName: string,
): FileSystemTree {
  return getTemplate(templateId).buildTree(projectName);
}
