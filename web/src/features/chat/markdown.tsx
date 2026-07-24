import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { createCodeArtefact } from '../../api/client';

type MarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'code'; text: string; language: string | null }
  | { type: 'ul'; items: string[] };

const SAVE_MIN_CHARS = 40;
const SAVE_MIN_LINES = 3;

function parseBlocks(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const parts = source.split(/```/);
  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i] ?? '';
    if (i % 2 === 1) {
      const langMatch = chunk.match(/^(\w+)\r?\n/);
      const language = langMatch?.[1] ?? null;
      const code = language
        ? chunk.slice(langMatch![0].length)
        : chunk.replace(/^\w*\n/, '');
      blocks.push({ type: 'code', text: code.trimEnd(), language });
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
        <code
          key={match.index}
          className="rounded bg-ink/80 px-1 py-0.5 text-[0.9em] text-signal"
        >
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

function isSubstantial(text: string): boolean {
  return (
    text.trim().length >= SAVE_MIN_CHARS ||
    text.split('\n').length >= SAVE_MIN_LINES
  );
}

type SaveContext = {
  projectId?: string | null;
  sessionId?: string | null;
};

function CodeBlock({
  text,
  language,
  saveContext,
  streaming,
}: {
  text: string;
  language: string | null;
  saveContext?: SaveContext;
  streaming?: boolean;
}) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canSave = !streaming && !!saveContext && isSubstantial(text);

  const onSave = async () => {
    if (!saveContext || !canSave) return;
    setStatus('saving');
    setError(null);
    try {
      const artefact = await createCodeArtefact({
        content: text,
        language: language ?? undefined,
        projectId: saveContext.projectId ?? null,
        sessionId: saveContext.sessionId ?? null,
      });
      setSavedId(artefact.id);
      setStatus('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  return (
    <div className="overflow-hidden rounded-[var(--radius-control)] border border-line bg-ink/80">
      <div className="flex items-center justify-between gap-2 border-b border-line/80 px-2 py-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-mist">
          {language ?? 'code'}
        </span>
        {canSave && status !== 'saved' && (
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={status === 'saving'}
            className="interactive text-[10px] font-semibold uppercase tracking-wider text-signal hover:underline disabled:opacity-50"
          >
            {status === 'saving' ? 'Saving…' : 'Save as code'}
          </button>
        )}
        {status === 'saved' && savedId && (
          <Link
            to={`/app/code/${savedId}`}
            className="interactive text-[10px] font-semibold uppercase tracking-wider text-teal hover:underline"
          >
            Saved · view
          </Link>
        )}
      </div>
      <pre className="overflow-x-auto p-2 font-mono text-xs text-mist">{text}</pre>
      {error && <p className="px-2 pb-2 text-[10px] text-ember">{error}</p>}
    </div>
  );
}

type MarkdownContentProps = {
  text: string;
  streaming?: boolean;
  /** When set, substantial code blocks offer “Save as code”. */
  saveContext?: SaveContext;
};

export function MarkdownContent({
  text,
  streaming,
  saveContext,
}: MarkdownContentProps) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2 text-sm leading-relaxed text-paper/90">
      {blocks.map((block, i) => {
        if (block.type === 'code') {
          return (
            <CodeBlock
              key={i}
              text={block.text}
              language={block.language}
              saveContext={saveContext}
              streaming={streaming}
            />
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
        <span
          className="inline-block h-4 w-0.5 animate-pulse bg-signal align-middle"
          aria-hidden
        />
      )}
    </div>
  );
}
