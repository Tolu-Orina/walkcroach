import type { PlanFile } from '../../api/types';

/** Durable plan artifact written to the sandbox on plan_preview / edits. */
export function formatPlanMarkdown(
  planId: string,
  files: PlanFile[],
): string {
  const lines = [
    '# WalkCroach plan',
    '',
    `Plan id: \`${planId}\``,
    '',
    'Proposed file changes:',
    '',
  ];
  for (const f of files) {
    lines.push(`## \`${f.path}\``);
    lines.push('');
    lines.push(`- Reason: ${f.reason}`);
    if (f.preview?.trim()) {
      lines.push('');
      lines.push('```');
      lines.push(f.preview.trim());
      lines.push('```');
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function planFilesEqual(a: PlanFile[], b: PlanFile[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((file, i) => {
    const other = b[i];
    return (
      other &&
      file.path === other.path &&
      file.reason === other.reason &&
      (file.preview ?? '') === (other.preview ?? '')
    );
  });
}

/** Structured adjustment when the user edits the plan before approve. */
export function formatEditedPlanAdjustment(
  original: PlanFile[],
  edited: PlanFile[],
): string {
  const kept = edited.map((f) => `- ${f.path}: ${f.reason}`).join('\n');
  const removed = original
    .filter((o) => !edited.some((e) => e.path === o.path))
    .map((f) => `- ${f.path}`)
    .join('\n');
  const parts = [
    'I edited the proposed file plan. Apply ONLY the files listed under Keep.',
    '',
    'Keep:',
    kept || '(none — revise the approach)',
  ];
  if (removed) {
    parts.push('', 'Omit (do not write these):', removed);
  }
  return parts.join('\n');
}
