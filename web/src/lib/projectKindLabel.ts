/** Glossary labels for picker / list surfaces (ADR-0004). */
export function projectKindLabel(
  kind: string | null | undefined,
): 'Project' | 'App Builder' | 'Chat' | 'Workspace' {
  switch (kind) {
    case 'knowledge':
      return 'Project';
    case 'app':
      return 'App Builder';
    case 'general':
      return 'Chat';
    default:
      return 'Workspace';
  }
}
