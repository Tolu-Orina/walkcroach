import { createProject, patchProject } from '../api/client';
import type { ProjectDetail } from '../api/types';

/**
 * Promote a Project (knowledge) into App Builder by creating a **new** kind=app
 * row. Copies name + description + standing instructions only — not documents
 * or memory (ADR-0004 Phase 6; prefer new row, not mutate in place).
 */
export async function promoteProjectToAppBuilder(
  project: ProjectDetail,
): Promise<string> {
  const created = await createProject(project.name, 'blank', { kind: 'app' });
  const description = project.description?.trim() || null;
  const instructions = project.instructions?.trim() || null;
  if (description || instructions) {
    await patchProject(created.id, { description, instructions });
  }
  return created.id;
}
