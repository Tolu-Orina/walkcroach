import type { ChatMessage } from '../../api/types';
import { MemoryRecallCard } from '../memory/MemoryRecallCard';
import { MarkdownContent } from './markdown';

type MessageRowProps = {
  msg: ChatMessage;
  streaming?: boolean;
  /** Enables “Save as code” on substantial fenced blocks. */
  saveContext?: {
    projectId?: string | null;
    sessionId?: string | null;
  };
};

function ToolCard({ msg }: { msg: ChatMessage }) {
  const label = msg.tool ?? msg.content.split(' ')[0] ?? 'tool';
  const awaiting = msg.awaitResult || msg.content.includes('(await)');

  return (
    <details className="group rounded-[var(--radius-control)] border border-signal/25 bg-signal/5">
      <summary className="interactive cursor-pointer list-none px-3 py-2.5 font-mono text-[11px] uppercase tracking-wide text-signal [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <span className="rounded-[0.3rem] bg-signal/20 px-1.5 py-0.5 text-[10px]">
            tool
          </span>
          <span>{label}</span>
          {awaiting && <span className="normal-case text-mist">running…</span>}
        </span>
      </summary>
      <div className="border-t border-signal/15 px-3 py-2 font-mono text-[11px] text-mist">
        {msg.content}
      </div>
    </details>
  );
}

export function MessageRow({ msg, streaming, saveContext }: MessageRowProps) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[92%] rounded-[var(--radius-surface)] border border-line bg-raised px-4 py-2.5 text-[15px] leading-relaxed text-paper sm:max-w-[80%]">
          {msg.content}
          {msg.attachments && msg.attachments.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-line/60 pt-2">
              {msg.attachments.map((a) => (
                <li
                  key={`${a.name}-${a.mime}`}
                  className="truncate font-mono text-[11px] text-mist"
                  title={a.name}
                >
                  {a.name}
                  <span className="text-mist/70"> · {a.mime}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (msg.role === 'tool') {
    return <ToolCard msg={msg} />;
  }

  if (msg.role === 'system') {
    if (msg.memoryHits && msg.memoryHits.length > 0) {
      return <MemoryRecallCard hits={msg.memoryHits} />;
    }
    return (
      <p className="text-center text-[12px] text-mist/90" role="status">
        {msg.content}
      </p>
    );
  }

  const isStreaming = streaming || msg.id.startsWith('stream-');

  return (
    <div className="flex gap-3">
      <img
        src="/walkcroach-icon.png"
        alt=""
        className="mt-0.5 h-7 w-7 shrink-0 rounded-lg opacity-90"
        width={28}
        height={28}
      />
      <div className="min-w-0 flex-1 pt-0.5 text-[15px] leading-relaxed">
        <MarkdownContent
          text={msg.content}
          streaming={isStreaming && !msg.content}
          saveContext={isStreaming ? undefined : saveContext}
        />
      </div>
    </div>
  );
}

export function StreamingSkeleton() {
  return (
    <div className="flex gap-3 px-1" aria-hidden>
      <div className="h-7 w-7 shrink-0 animate-pulse rounded-lg bg-line" />
      <div className="flex-1 space-y-2.5 pt-1">
        <div className="h-3 w-4/5 animate-pulse rounded bg-line" />
        <div className="h-3 w-3/5 animate-pulse rounded bg-line" />
      </div>
    </div>
  );
}
