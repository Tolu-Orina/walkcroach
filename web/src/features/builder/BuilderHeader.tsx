import { Link } from 'react-router-dom';
import type { AgentMode } from '../../api/types';
import { useAuth } from '../../auth/useAuth';
import { UsageMeter } from '../billing/UsageMeter';

type BuilderHeaderProps = {
  projectId: string;
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
  focusMode: boolean;
  onToggleFocus: () => void;
  onChooseStarter: () => void;
  /** Opens the Git push checklist before IDE connect. */
  onOpenInIde: () => void;
};

/** Compact Builder chrome (~30% denser than the previous header). */
export function BuilderHeader({
  projectId,
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
  focusMode,
  onToggleFocus,
  onChooseStarter,
  onOpenInIde,
}: BuilderHeaderProps) {
  const { user, signOut } = useAuth();

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 sm:px-3.5">
      <div className="min-w-0">
        <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
          <Link
            to={`/app/projects/${projectId}`}
            className="interactive text-[10px] font-semibold text-mist hover:text-signal"
          >
            ← Project
          </Link>
          <button
            type="button"
            onClick={onToggleFocus}
            aria-pressed={focusMode}
            className={`interactive rounded-[var(--radius-control)] border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider ${
              focusMode
                ? 'border-signal/40 bg-signal/10 text-signal'
                : 'border-line text-mist hover:text-paper'
            }`}
          >
            {focusMode ? 'Focus on' : 'Focus off'}
          </button>
        </div>
        <p className="truncate font-display text-base font-extrabold tracking-tight text-paper sm:text-lg">
          {projectName}
        </p>
        <p className="mt-px text-[10px] text-mist sm:text-[11px]">
          <button
            type="button"
            onClick={onChooseStarter}
            className="interactive text-mist underline-offset-2 hover:text-signal hover:underline"
            title="Choose or change starter template"
          >
            {templateName}
          </button>
          <span
            className={`ml-1.5 inline-flex rounded-[var(--radius-control)] px-1 py-px text-[9px] font-medium uppercase tracking-wider ${
              mode === 'plan'
                ? 'bg-panel text-mist'
                : 'bg-signal/15 text-signal'
            }`}
          >
            {mode === 'plan' ? 'Planning' : 'Building'}
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
        <UsageMeter />
        {latestDeployUrl && (
          <a
            href={latestDeployUrl}
            target="_blank"
            rel="noreferrer"
            className="interactive hidden max-w-[9rem] truncate text-[10px] text-signal hover:underline sm:inline"
          >
            Live URL
          </a>
        )}
        <button
          type="button"
          onClick={onDeploy}
          disabled={deployDisabled || deployBusy}
          className={`interactive rounded-[var(--radius-control)] border border-line px-2 py-1 text-[10px] uppercase tracking-wider sm:px-2.5 ${
            deployDisabled || deployBusy
              ? 'cursor-not-allowed opacity-40 text-mist'
              : 'text-mist hover:text-paper'
          }`}
          data-wc-tour="deploy-cta"
        >
          {deployBusy ? 'Deploying…' : 'Deploy'}
        </button>
        <div
          className="flex overflow-hidden rounded-[var(--radius-control)] border border-line text-[10px] uppercase tracking-wider"
          role="group"
          aria-label="Agent mode"
          data-wc-tour="plan-mode"
        >
          <button
            type="button"
            className={`interactive px-2 py-1 sm:px-2.5 ${mode === 'plan' ? 'bg-signal text-ink' : 'text-mist hover:text-paper'}`}
            aria-pressed={mode === 'plan'}
            onClick={() => onModeChange('plan')}
          >
            Plan
          </button>
          <button
            type="button"
            className={`interactive px-2 py-1 sm:px-2.5 ${mode === 'build' ? 'bg-signal text-ink' : 'text-mist hover:text-paper'}`}
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
            className="interactive rounded-[var(--radius-control)] border border-ember/50 px-2 py-1 text-[10px] text-ember hover:bg-ember/10"
          >
            Stop
          </button>
        )}
        <details className="relative">
          <summary className="interactive cursor-pointer list-none rounded-[var(--radius-control)] border border-line px-2 py-1 text-[10px] text-mist hover:text-paper [&::-webkit-details-marker]:hidden">
            {user?.displayName?.split(' ')[0] ?? 'Account'}
          </summary>
          <div className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-[var(--radius-surface)] border border-line bg-panel py-1 shadow-lg">
            <Link
              to="/app/projects"
              className="interactive block px-3 py-2 text-sm text-mist hover:bg-ink/60 hover:text-paper"
            >
              Projects
            </Link>
            <button
              type="button"
              onClick={onOpenInIde}
              className="interactive block w-full px-3 py-2 text-left text-sm text-mist hover:bg-ink/60 hover:text-paper"
              title="IDE continues via project memory and Git — not this Builder sandbox session"
            >
              Open in IDE
            </button>
            <p className="border-t border-line px-3 py-2 text-[10px] leading-snug text-mist/80">
              Checklist: connect GitHub → push → IDE sign-in. Sandbox does not
              hand off.
            </p>
            <button
              type="button"
              onClick={() => void onNewSession()}
              className="interactive block w-full px-3 py-2 text-left text-sm text-mist hover:bg-ink/60 hover:text-paper"
            >
              New session
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
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
