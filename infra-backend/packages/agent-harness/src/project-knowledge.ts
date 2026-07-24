/**
 * Load standing project knowledge for agent system prompts (Phase C).
 */
import type { DbClient } from '@walkcroach/db';

export type ProjectKnowledge = {
  name: string;
  description: string | null;
  instructions: string | null;
  documents: Array<{ id: string; name: string; excerpt: string }>;
};

export async function loadProjectKnowledge(
  db: DbClient,
  projectId: string,
): Promise<ProjectKnowledge | null> {
  const { rows } = await db.query<{
    name: string;
    description: string | null;
    instructions: string | null;
  }>(
    `SELECT name, description, instructions
     FROM projects
     WHERE id = $1::uuid AND deleted_at IS NULL`,
    [projectId],
  );
  const project = rows[0];
  if (!project) return null;

  const docs = await db.query<{
    id: string;
    name: string;
    text_content: string | null;
  }>(
    `SELECT id, name, text_content
     FROM project_documents
     WHERE project_id = $1::uuid
     ORDER BY created_at DESC
     LIMIT 12`,
    [projectId],
  );

  return {
    name: project.name,
    description: project.description,
    instructions: project.instructions,
    documents: docs.rows.map((d) => ({
      id: d.id,
      name: d.name,
      excerpt: (d.text_content ?? '').slice(0, 4000),
    })),
  };
}

/** Format knowledge block appended to the agent system prompt. */
export function formatProjectKnowledgeBlock(
  knowledge: ProjectKnowledge,
): string {
  const parts: string[] = [
    `Project: ${knowledge.name}`,
  ];
  if (knowledge.description?.trim()) {
    parts.push(`Description:\n${knowledge.description.trim()}`);
  }
  if (knowledge.instructions?.trim()) {
    parts.push(
      `Standing instructions (follow across all chats in this project):\n${knowledge.instructions.trim()}`,
    );
  }
  if (knowledge.documents.length > 0) {
    parts.push('Project documents (excerpts):');
    for (const doc of knowledge.documents) {
      if (!doc.excerpt.trim()) {
        parts.push(`- ${doc.name} (no text extracted)`);
        continue;
      }
      parts.push(`--- ${doc.name} ---\n${doc.excerpt}`);
    }
  }
  return parts.join('\n\n');
}
