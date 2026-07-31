type ConnectorProposal = {
  runId: string;
  action: string;
  title: string;
  consequence: string;
  write: boolean;
  irreversible: boolean;
  weight: number;
  rows: Array<{ label: string; value: string }>;
  needsConnection?: string;
  connectUrl?: string;
};

type Props = {
  pending: ConnectorProposal;
  busy?: boolean;
  onConfirm: () => void;
  onDecline: () => void;
};

/** Propose → confirm → execute for connector writes (Phase F3). */
export function ConnectorConfirmCard({
  pending,
  busy,
  onConfirm,
  onDecline,
}: Props) {
  const blocked = Boolean(pending.needsConnection) || !pending.runId;

  return (
    <div
      className="rounded-[var(--radius-surface)] border border-signal/35 bg-raised/80 p-4"
      role="region"
      aria-label="Confirm connector action"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-wide text-signal">
            Connectors
          </p>
          <h3 className="mt-1 truncate font-display text-lg font-bold text-paper">
            {pending.title}
          </h3>
          <p className="mt-0.5 text-sm text-mist">{pending.consequence}</p>
        </div>
        {pending.irreversible && (
          <span className="shrink-0 rounded-[0.3rem] border border-ember/50 px-1.5 py-0.5 font-mono text-[10px] text-ember">
            irreversible
          </span>
        )}
      </div>

      {pending.rows.length > 0 && (
        <dl className="mt-3 space-y-1.5 border-t border-line/60 pt-3">
          {pending.rows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[7rem_1fr] gap-2 text-[13px]"
            >
              <dt className="font-mono text-[10px] uppercase text-mist">
                {row.label}
              </dt>
              <dd className="break-words text-paper">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {blocked && pending.connectUrl && (
        <p className="mt-3 border-t border-line/60 pt-3 text-sm text-mist">
          Connect{' '}
          <span className="font-semibold text-paper">
            {pending.needsConnection}
          </span>{' '}
          first:{' '}
          <a
            href={pending.connectUrl}
            className="font-semibold text-signal underline-offset-2 hover:underline"
          >
            Settings → Connections
          </a>
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!blocked && (
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="interactive rounded-[var(--radius-control)] bg-signal px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
          >
            {busy
              ? 'Executing…'
              : `Confirm · ${pending.weight} credit${pending.weight === 1 ? '' : 's'}`}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onDecline}
          className="btn-ghost text-sm disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
