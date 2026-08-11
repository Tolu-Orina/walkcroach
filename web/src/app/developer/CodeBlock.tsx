import { useState } from 'react';

/** Shared copyable code surface for developer portal docs / overview. */
export function CodeBlock({
  children,
  label = 'Copy',
}: {
  children: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-[var(--radius-control)] border border-line bg-ink/50">
      <div className="flex items-center justify-end border-b border-line/70 px-2 py-1">
        <button
          type="button"
          className="btn-ghost text-[11px]"
          onClick={() => void onCopy()}
        >
          {copied ? 'Copied' : label}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-[12px] leading-relaxed text-paper">
        <code>{children}</code>
      </pre>
    </div>
  );
}
