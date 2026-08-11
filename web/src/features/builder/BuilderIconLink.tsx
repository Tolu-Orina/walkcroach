import { Link } from 'react-router-dom';
import { builderWorkspacePath } from '../../lib/builderRoutes';

/** App Builder affordance — split-pane mark (chat | preview). */
export function IconBuilder({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      aria-hidden
    >
      <rect
        x="3.5"
        y="5"
        width="17"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M10.5 5v14" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

type BuilderIconLinkProps = {
  projectId: string;
  className?: string;
  /** Visible label next to the icon (omit for icon-only). */
  label?: string;
};

export function BuilderIconLink({
  projectId,
  className = '',
  label,
}: BuilderIconLinkProps) {
  return (
    <Link
      to={builderWorkspacePath(projectId)}
      title="Open App Builder"
      aria-label="Open App Builder"
      className={`interactive inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-mist hover:border-signal/40 hover:text-paper ${className}`}
    >
      <IconBuilder />
      {label ? (
        <span className="text-xs font-medium tracking-tight">{label}</span>
      ) : null}
    </Link>
  );
}
