export function planDisplayName(
  plan: string | null | undefined,
  billingPlanName?: string | null,
): string {
  if (billingPlanName) return billingPlanName;
  if (plan === 'starter') return 'Starter';
  if (plan === 'pro' || plan === 'paid') return 'Pro';
  if (plan === 'free') return 'Free';
  return '—';
}

const COST_LABELS: Record<string, string> = {
  memory_remember: 'Memory remember',
  memory_recall: 'Memory recall',
  memory_import: 'Memory import',
  memory_list: 'Memory list',
  memory_export: 'Memory export',
  memory_diff: 'Memory diff',
  memory_erase: 'Memory erase',
  memory_audit: 'Memory audit',
  content_publish: 'Content publish',
  graph_run: 'Graph run',
  agent_turn: 'Agent turn',
  generate_image: 'Image gen',
  render_pptx: 'Deck render',
  render_flyer: 'Flyer render',
  start_video_job: 'Video job',
  connector_read: 'Connector read',
  connector_write: 'Connector write',
};

export function actionDisplayName(action: string): string {
  return COST_LABELS[action] ?? action.replace(/_/g, ' ');
}

/** Prefer SDK/memory rows; fall back to full cost map. */
export function costRows(
  costs: Record<string, number> | undefined,
): Array<{ key: string; label: string; credits: number }> {
  if (!costs) return [];
  const preferred = [
    'memory_remember',
    'memory_recall',
    'memory_list',
    'memory_export',
    'memory_diff',
    'memory_erase',
    'memory_audit',
    'memory_import',
    'content_publish',
    'graph_run',
    'agent_turn',
  ];
  const rows: Array<{ key: string; label: string; credits: number }> = [];
  const seen = new Set<string>();
  for (const key of preferred) {
    if (key in costs) {
      rows.push({
        key,
        label: COST_LABELS[key] ?? key,
        credits: costs[key]!,
      });
      seen.add(key);
    }
  }
  for (const [key, credits] of Object.entries(costs)) {
    if (seen.has(key)) continue;
    rows.push({
      key,
      label: COST_LABELS[key] ?? key.replace(/_/g, ' '),
      credits,
    });
  }
  return rows;
}
