import type { ChatMessage } from '../../api/types';
import { MarkdownContent } from './markdown';

type MessageRowProps = {
  msg: ChatMessage;
  streaming?: boolean;
};

function ToolCard({ msg }: { msg: ChatMessage }) {
  const label = msg.tool ?? msg.content.split(' ')[0] ?? 'tool';
  const awaiting = msg.awaitResult || msg.content.includes('(await)');

  return (
    <details className="group rounded-sm border border-signal/25 bg-signal/5">
      <summary className="interactive cursor-pointer list-none px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-signal [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <span className="rounded-sm bg-signal/20 px-1.5 py-0.5 text-[10px]">tool</span>
          <span>{label}</span>
          {awaiting && <span className="text-mist normal-case">running…</span>}
        </span>
      </summary>
      <div className="border-t border-signal/15 px-3 py-2 font-mono text-[11px] text-mist">
        {msg.content}
      </div>
    </details>
  );
}

export function MessageRow({ msg, streaming }: MessageRowProps) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[92%] rounded-sm border border-line bg-panel/90 px-3 py-2 text-sm text-paper sm:max-w-[85%]">
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.role === 'tool') {
    return <ToolCard msg={msg} />;
  }

  if (msg.role === 'system') {
    return (
      <p className="text-center text-[12px] text-mist/90" role="status">
        {msg.content}
      </p>
    );
  }

  const isStreaming = streaming || msg.id.startsWith('stream-');

  return (
    <div className="flex gap-2">
      <img
        src="/walkcroach-icon.png"
        alt=""
        className="mt-0.5 h-6 w-6 shrink-0 rounded-sm opacity-80"
        width={24}
        height={24}
      />
      <div className="min-w-0 flex-1">
        <MarkdownContent text={msg.content} streaming={isStreaming && !msg.content} />
      </div>
    </div>
  );
}

export function StreamingSkeleton() {
  return (
    <div className="flex gap-2 px-1" aria-hidden>
      <div className="h-6 w-6 shrink-0 animate-pulse rounded-sm bg-line" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-4/5 animate-pulse rounded-sm bg-line" />
        <div className="h-3 w-3/5 animate-pulse rounded-sm bg-line" />
      </div>
    </div>
  );
}
