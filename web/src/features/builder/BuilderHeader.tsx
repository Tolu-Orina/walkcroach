import { Link } from 'react-router-dom';
import type { AgentMode } from '../../api/types';
import { useAuth } from '../../auth/useAuth';
import { UsageMeter } from '../billing/UsageMeter';

type BuilderHeaderProps = {
  projectName: string;
  templateName: string;
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  streaming: boolean;
  onCancelStream: () => void;
  onNewSession: () => void;
  onDeploy: () => void;
  deployBusy: boolean;
  deployDisabled: boolean;
  latestDeployUrl?: string | null;
};

export function BuilderHeader({
  projectName,
  templateName,
  mode,
  onModeChange,
  streaming,
  onCancelStream,
  onNewSession,
  onDeploy,
  deployBusy,
  deployDisabled,
  latestDeployUrl,
}: BuilderHeaderProps) {
  const { user, signOut } = useAuth();

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <p className="truncate font-display text-xl font-extrabold tracking-tight text-paper sm:text-2xl">
          {projectName}
        </p>
        <p className="mt-0.5 text-xs text-mist sm:text-sm">
          {templateName}
          <span
            className={`ml-2 inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
              mode === 'plan'
                ? 'bg-panel text-mist'
                : 'bg-signal/15 text-signal'
            }`}
          >
            {mode === 'plan' ? 'Planning' : 'Building'}
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
        <UsageMeter />
        {latestDeployUrl && (
          <a
            href={latestDeployUrl}
            target="_blank"
            rel="noreferrer"
            className="interactive hidden max-w-[10rem] truncate text-[11px] text-signal hover:underline sm:inline"
          >
            Live URL
          </a>
        )}
        <button
          type="button"
          onClick={onDeploy}
          disabled={deployDisabled || deployBusy}
          className="btn-primary px-3 py-1.5 text-xs"
          data-wc-tour="deploy-cta"
        >
          {deployBusy ? 'Deploying…' : 'Deploy'}
        </button>
        <div
          className="flex overflow-hidden rounded-sm border border-line text-[11px] uppercase tracking-wider"
          role="group"
          aria-label="Agent mode"
          data-wc-tour="plan-mode"
        >
          <button
            type="button"
            className={`interactive px-2.5 py-1.5 sm:px-3 ${mode === 'plan' ? 'bg-signal text-ink' : 'text-mist hover:text-paper'}`}
            aria-pressed={mode === 'plan'}
            onClick={() => onModeChange('plan')}
          >
            Plan
          </button>
          <button
            type="button"
            className={`interactive px-2.5 py-1.5 sm:px-3 ${mode === 'build' ? 'bg-signal text-ink' : 'text-mist hover:text-paper'}`}
            aria-pressed={mode === 'build'}
            onClick={() => onModeChange('build')}
          >
            Build
          </button>
        </div>
        {streaming && (
          <button
            type="button"
            onClick={onCancelStream}
            className="interactive rounded-sm border border-ember/50 px-2.5 py-1.5 text-[11px] text-ember hover:bg-ember/10"
          >
            Stop
          </button>
        )}
        <details className="relative">
          <summary className="interactive cursor-pointer list-none rounded-sm border border-line px-2.5 py-1.5 text-[11px] text-mist hover:text-paper [&::-webkit-details-marker]:hidden">
            {user?.displayName?.split(' ')[0] ?? 'Account'}
          </summary>
          <div className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-sm border border-line bg-panel py-1 shadow-lg">
            <Link
              to="/dashboard"
              className="interactive block px-3 py-2 text-sm text-mist hover:bg-ink/60 hover:text-paper"
            >
              Projects
            </Link>
            <button
              type="button"
              onClick={() => void onNewSession()}
              className="interactive block w-full px-3 py-2 text-left text-sm text-mist hover:bg-ink/60 hover:text-paper"
            >
              New session
            </button>
            <button
              type="button"
              onClick={signOut}
              className="interactive block w-full px-3 py-2 text-left text-sm text-ember hover:bg-ink/60"
            >
              Sign out
            </button>
          </div>
        </details>
      </div>
    </header>
  );
}
