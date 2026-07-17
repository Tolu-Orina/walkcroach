import { useState } from 'react';
import type { PlanFile, PendingPlan } from '../../api/types';

type PlanReviewCardProps = {
  plan: PendingPlan;
  disabled?: boolean;
  onApprove: () => void;
  onAdjust: (feedback: string) => void;
  onCancel: () => void;
};

export function PlanReviewCard({
  plan,
  disabled,
  onApprove,
  onAdjust,
  onCancel,
}: PlanReviewCardProps) {
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [feedback, setFeedback] = useState('');

  return (
    <div className="rounded-sm border border-signal/40 bg-signal/5 p-4">
      <p className="text-[10px] uppercase tracking-wider text-signal">Plan review</p>
      <p className="mt-1 text-sm text-paper">
        The agent wants to write <strong>{plan.files.length}</strong> files. Approve before
        changes land in the preview.
      </p>
      <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs text-mist">
        {plan.files.map((f: PlanFile) => (
          <li key={f.path} className="font-mono">
            <span className="text-paper">{f.path}</span>
            <span className="text-mist/70"> — {f.reason}</span>
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
            disabled={disabled}
            onClick={onApprove}
            className="rounded-sm bg-signal px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-ink disabled:opacity-40"
          >
            Approve
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
