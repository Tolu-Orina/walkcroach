import { useState } from 'react';
import type { PlanFile, PendingPlan } from '../../api/types';
import { planFilesEqual } from './planMarkdown';

type PlanReviewCardProps = {
  plan: PendingPlan;
  disabled?: boolean;
  onApprove: () => void;
  /** Called when the user edited the file list — sends structured adjustment. */
  onApproveEdited: (edited: PlanFile[]) => void;
  onAdjust: (feedback: string) => void;
  onCancel: () => void;
  onPlanEdited?: (edited: PlanFile[]) => void;
};

export function PlanReviewCard({
  plan,
  disabled,
  onApprove,
  onApproveEdited,
  onAdjust,
  onCancel,
  onPlanEdited,
}: PlanReviewCardProps) {
  const [files, setFiles] = useState<PlanFile[]>(plan.files);
  const [seededPlanId, setSeededPlanId] = useState(plan.planId);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Re-seed editable rows only when a new plan arrives (not on parent re-renders).
  if (plan.planId !== seededPlanId) {
    setSeededPlanId(plan.planId);
    setFiles(plan.files);
    setExpanded(null);
    setAdjustOpen(false);
    setFeedback('');
  }

  const dirty = !planFilesEqual(files, plan.files);

  const updateFile = (index: number, patch: Partial<PlanFile>) => {
    setFiles((prev) => {
      const next = prev.map((f, i) => (i === index ? { ...f, ...patch } : f));
      onPlanEdited?.(next);
      return next;
    });
  };

  const removeFile = (index: number) => {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      onPlanEdited?.(next);
      return next;
    });
  };

  return (
    <div className="rounded-sm border border-signal/40 bg-signal/5 p-4">
      <p className="text-[10px] uppercase tracking-wider text-signal">Plan review</p>
      <p className="mt-1 text-sm text-paper">
        The agent wants to write <strong>{files.length}</strong> file
        {files.length === 1 ? '' : 's'}. Edit the list, then approve — changes
        also sync to <span className="font-mono text-mist">plan.md</span>.
      </p>
      {dirty && (
        <p className="mt-1 text-[11px] text-signal">
          Plan edited — Approve will send your revised list to the agent.
        </p>
      )}

      <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto text-xs">
        {files.map((f, index) => (
          <li
            key={`${f.path}-${index}`}
            className="rounded-sm border border-line/60 bg-ink/40 px-2 py-2"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <input
                  value={f.path}
                  onChange={(e) => updateFile(index, { path: e.target.value })}
                  disabled={disabled}
                  className="w-full bg-transparent font-mono text-[11px] text-paper outline-none focus:underline"
                  aria-label="File path"
                />
                <input
                  value={f.reason}
                  onChange={(e) => updateFile(index, { reason: e.target.value })}
                  disabled={disabled}
                  className="w-full bg-transparent text-[11px] text-mist outline-none focus:text-paper"
                  aria-label="Reason"
                />
              </div>
              <div className="flex shrink-0 gap-1">
                {f.preview && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      setExpanded((cur) => (cur === f.path ? null : f.path))
                    }
                    className="text-[10px] uppercase tracking-wider text-mist hover:text-paper"
                  >
                    {expanded === f.path ? 'Hide' : 'Preview'}
                  </button>
                )}
                <button
                  type="button"
                  disabled={disabled || files.length <= 1}
                  onClick={() => removeFile(index)}
                  className="text-[10px] uppercase tracking-wider text-ember hover:underline disabled:opacity-30"
                >
                  Remove
                </button>
              </div>
            </div>
            {expanded === f.path && f.preview && (
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-sm border border-line/40 bg-ink/70 p-2 font-mono text-[10px] text-mist">
                {f.preview}
              </pre>
            )}
          </li>
        ))}
      </ul>

      {adjustOpen ? (
        <div className="mt-3 space-y-2">
          <textarea
            rows={2}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What should change in the plan?"
            className="w-full resize-none rounded-sm border border-line bg-ink/60 px-2 py-1.5 text-sm text-paper"
            disabled={disabled}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={disabled || !feedback.trim()}
              onClick={() => {
                onAdjust(feedback.trim());
                setAdjustOpen(false);
                setFeedback('');
              }}
              className="rounded-sm bg-signal px-3 py-1 text-xs font-medium text-ink disabled:opacity-40"
            >
              Send adjustment
            </button>
            <button
              type="button"
              onClick={() => setAdjustOpen(false)}
              className="text-xs text-mist hover:text-paper"
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled || files.length === 0}
            onClick={() => {
              if (dirty) onApproveEdited(files);
              else onApprove();
            }}
            className="rounded-sm bg-signal px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-ink disabled:opacity-40"
          >
            {dirty ? 'Approve edited' : 'Approve'}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setAdjustOpen(true)}
            className="rounded-sm border border-line px-3 py-1.5 text-xs text-paper hover:border-signal/40 disabled:opacity-40"
          >
            Adjust
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onCancel}
            className="rounded-sm px-3 py-1.5 text-xs text-ember hover:underline disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
