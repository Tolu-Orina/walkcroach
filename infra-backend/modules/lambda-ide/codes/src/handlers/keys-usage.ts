/**
 * Pure aggregation for GET /v1/keys/usage (P3).
 * Ledger rows with metadata.keyId → per-key + by-action totals.
 */

/** Actions attributed to API keys on the shared credit pool. */
export const SDK_KEY_USAGE_ACTIONS = [
  'memory_remember',
  'memory_recall',
  'memory_import',
  'memory_list',
  'memory_export',
  'memory_diff',
  'memory_erase',
  'memory_audit',
  'content_publish',
  'graph_run',
] as const;

export type SdkKeyUsageAction = (typeof SDK_KEY_USAGE_ACTIONS)[number];

export type UsageLedgerAggRow = {
  key_id: string;
  action_type: string;
  count: string | number;
  credits: string | number;
};

export type ActionUsage = {
  action: string;
  count: number;
  credits: number;
};

/** Backward-compatible counters + extended fields for portal charts. */
export type ApiKeyUsageKeyRow = {
  keyId: string;
  remember: number;
  recall: number;
  import: number;
  list: number;
  export: number;
  diff: number;
  erase: number;
  audit: number;
  contentPublish: number;
  graphRun: number;
  credits: number;
  byAction: ActionUsage[];
};

export type ApiKeyUsagePayload = {
  period: 'month';
  sku: 'shared_pool';
  keys: ApiKeyUsageKeyRow[];
  byAction: ActionUsage[];
  invoice: {
    model: 'shared_pool';
    summary: string;
  };
};

const INVOICE_SUMMARY =
  'One monthly credit pool covers Web/Chrome creatives and SDK /v1 calls. ' +
  'Rows below are ledger debits tagged with metadata.keyId (API-key traffic). ' +
  'Interactive Cognito calls still debit the pool but are not listed per key. ' +
  'IDE/CLI/Desktop BYOK Bedrock inference is not metered here.';

function emptyKeyRow(keyId: string): ApiKeyUsageKeyRow {
  return {
    keyId,
    remember: 0,
    recall: 0,
    import: 0,
    list: 0,
    export: 0,
    diff: 0,
    erase: 0,
    audit: 0,
    contentPublish: 0,
    graphRun: 0,
    credits: 0,
    byAction: [],
  };
}

function applyAction(row: ApiKeyUsageKeyRow, action: string, count: number): void {
  switch (action) {
    case 'memory_remember':
      row.remember = count;
      break;
    case 'memory_recall':
      row.recall = count;
      break;
    case 'memory_import':
      row.import = count;
      break;
    case 'memory_list':
      row.list = count;
      break;
    case 'memory_export':
      row.export = count;
      break;
    case 'memory_diff':
      row.diff = count;
      break;
    case 'memory_erase':
      row.erase = count;
      break;
    case 'memory_audit':
      row.audit = count;
      break;
    case 'content_publish':
      row.contentPublish = count;
      break;
    case 'graph_run':
      row.graphRun = count;
      break;
    default:
      break;
  }
}

/** Aggregate raw GROUP BY rows into the portal/OpenAPI payload. */
export function aggregateApiKeyUsage(
  rows: UsageLedgerAggRow[],
): ApiKeyUsagePayload {
  const byKey: Record<string, ApiKeyUsageKeyRow> = {};
  const actionTotals: Record<string, ActionUsage> = {};

  for (const r of rows) {
    const id = r.key_id;
    if (!id) continue;
    if (!byKey[id]) byKey[id] = emptyKeyRow(id);

    const count = Number(r.count) || 0;
    const credits = Number(r.credits) || 0;
    const action = r.action_type;

    byKey[id]!.credits += credits;
    applyAction(byKey[id]!, action, count);
    byKey[id]!.byAction.push({ action, count, credits });

    if (!actionTotals[action]) {
      actionTotals[action] = { action, count: 0, credits: 0 };
    }
    actionTotals[action]!.count += count;
    actionTotals[action]!.credits += credits;
  }

  const actionOrder = new Map(
    SDK_KEY_USAGE_ACTIONS.map((a, i) => [a, i] as const),
  );
  const byAction = Object.values(actionTotals).sort((a, b) => {
    const ai = actionOrder.get(a.action as SdkKeyUsageAction) ?? 999;
    const bi = actionOrder.get(b.action as SdkKeyUsageAction) ?? 999;
    return ai - bi || a.action.localeCompare(b.action);
  });

  for (const key of Object.values(byKey)) {
    key.byAction.sort((a, b) => {
      const ai = actionOrder.get(a.action as SdkKeyUsageAction) ?? 999;
      const bi = actionOrder.get(b.action as SdkKeyUsageAction) ?? 999;
      return ai - bi || a.action.localeCompare(b.action);
    });
  }

  return {
    period: 'month',
    sku: 'shared_pool',
    keys: Object.values(byKey),
    byAction,
    invoice: {
      model: 'shared_pool',
      summary: INVOICE_SUMMARY,
    },
  };
}

export const SDK_KEY_USAGE_ACTION_SQL = SDK_KEY_USAGE_ACTIONS.map(
  (a) => `'${a}'`,
).join(', ');
