import type { ChatMessage } from '../../api/types';

export function MessageRow({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'user') {
    return (
      <div className="ml-8 rounded-sm border border-line bg-panel/80 px-3 py-2 text-sm text-paper">
        {msg.content}
      </div>
    );
  }
  if (msg.role === 'tool') {
    return (
      <div className="inline-flex items-center gap-2 rounded-sm border border-signal/30 bg-signal/10 px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-signal">
        {msg.content}
      </div>
    );
  }
  if (msg.role === 'system') {
    return <p className="text-[12px] text-mist">{msg.content}</p>;
  }
  return (
    <div className="mr-4 whitespace-pre-wrap text-sm leading-relaxed text-paper/90">
      {msg.content}
    </div>
  );
}
