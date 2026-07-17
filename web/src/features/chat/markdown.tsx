import type { ReactNode } from 'react';

type MarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'code'; text: string }
  | { type: 'ul'; items: string[] };

function parseBlocks(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const parts = source.split(/```/);
  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i] ?? '';
    if (i % 2 === 1) {
      const code = chunk.replace(/^\w*\n/, '');
      blocks.push({ type: 'code', text: code.trimEnd() });
      continue;
    }
    const paragraphs = chunk.split(/\n\n+/);
    for (const p of paragraphs) {
      const text = p.trim();
      if (!text) continue;
      if (text.split('\n').every((line) => line.trim().startsWith('- '))) {
        blocks.push({
          type: 'ul',
          items: text
            .split('\n')
            .map((line) => line.trim().replace(/^- /, ''))
            .filter(Boolean),
        });
      } else {
        blocks.push({ type: 'paragraph', text });
      }
    }
  }
  return blocks;
}

function inlineFormat(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(
        <code key={match.index} className="rounded bg-ink/80 px-1 py-0.5 text-[0.9em] text-signal">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      nodes.push(
        <strong key={match.index} className="font-semibold text-paper">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      const m = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (m) {
        nodes.push(
          <a
            key={match.index}
            href={m[2]}
            target="_blank"
            rel="noreferrer"
            className="interactive text-signal underline-offset-2 hover:underline"
          >
            {m[1]}
          </a>,
        );
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type MarkdownContentProps = {
  text: string;
  streaming?: boolean;
};

export function MarkdownContent({ text, streaming }: MarkdownContentProps) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2 text-sm leading-relaxed text-paper/90">
      {blocks.map((block, i) => {
        if (block.type === 'code') {
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-sm border border-line bg-ink/80 p-2 font-mono text-xs text-mist"
            >
              {block.text}
            </pre>
          );
        }
        if (block.type === 'ul') {
          return (
            <ul key={i} className="list-inside list-disc space-y-1 text-mist">
              {block.items.map((item, j) => (
                <li key={j}>{inlineFormat(item)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inlineFormat(block.text)}
          </p>
        );
      })}
      {streaming && (
        <span className="inline-block h-4 w-0.5 animate-pulse bg-signal align-middle" aria-hidden />
      )}
    </div>
  );
}
