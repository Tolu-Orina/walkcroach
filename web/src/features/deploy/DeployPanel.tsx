import type { DeploymentSummary } from '../../api/client';

type DeployPanelProps = {
  deployments: DeploymentSummary[];
  busy: boolean;
  error: string | null;
  onDeploy: () => void;
  disabled?: boolean;
  embedded?: boolean;
  hideButton?: boolean;
};

export function DeployPanel({
  deployments,
  busy,
  error,
  onDeploy,
  disabled,
  embedded = false,
  hideButton = false,
}: DeployPanelProps) {
  const latest = deployments[0];

  return (
    <div className={embedded ? 'px-4 py-3' : 'border-t border-line px-3 py-2'}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-mist">Deploy</p>
        {!hideButton && (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={onDeploy}
            className="btn-primary px-2 py-1 text-[10px] disabled:opacity-40"
          >
            {busy ? 'Deploying…' : 'Deploy'}
          </button>
        )}
      </div>
      <p className="mt-0.5 text-[10px] text-mist/80">
        Publishes to{' '}
        <span className="font-mono text-mist">
          {'{slug}'}.walkcroach.conquerorfoundation.com
        </span>
      </p>
      {latest?.url && (
        <p className="mt-1 truncate font-mono text-[10px] text-signal">
          <a href={latest.url} target="_blank" rel="noreferrer" className="hover:underline">
            {latest.url}
          </a>
          {' · '}
          {latest.status}
        </p>
      )}
      {deployments.length > 1 && (
        <ul className="mt-2 max-h-20 space-y-1 overflow-y-auto text-[10px] text-mist">
          {deployments.slice(0, 5).map((d) => (
            <li key={d.id} className="flex justify-between gap-2">
              <span className="truncate">{d.status}</span>
              <span className="shrink-0">{new Date(d.deployedAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-[10px] text-ember">{error}</p>}
    </div>
  );
}
