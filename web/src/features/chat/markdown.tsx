import {
  memo,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createCodeArtefact } from '../../api/client';
import { prepareMarkdown, splitIntoBlocks } from './markdownPrepare';

const SAVE_MIN_CHARS = 40;
const SAVE_MIN_LINES = 3;

/** Stable plugin list — recreating this on every render defeats memoization. */
const REMARK_PLUGINS = [remarkGfm];

type SaveContext = {
  projectId?: string | null;
  sessionId?: string | null;
};

type MarkdownContentProps = {
  text: string;
  streaming?: boolean;
  /** When set, substantial code blocks offer “Save as code”. */
  saveContext?: SaveContext;
};

function isSubstantial(text: string): boolean {
  return (
    text.trim().length >= SAVE_MIN_CHARS ||
    text.split('\n').length >= SAVE_MIN_LINES
  );
}

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

function createMarkdownComponents(
  saveContext: SaveContext | undefined,
  streaming: boolean | undefined,
): Components {
  return {
    h1: ({ children }) => (
      <h1 className="font-display text-xl font-semibold tracking-tight text-paper">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="font-display text-lg font-semibold tracking-tight text-paper">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="font-display text-base font-semibold tracking-tight text-paper">
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-sm font-semibold text-paper">{children}</h4>
    ),
    p: ({ children }) => (
      <p className="whitespace-pre-wrap text-paper/90">{children}</p>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-paper">{children}</strong>
    ),
    em: ({ children }) => <em className="italic text-paper/90">{children}</em>,
    del: ({ children }) => (
      <del className="text-mist line-through">{children}</del>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-signal/40 pl-3 text-mist">
        {children}
      </blockquote>
    ),
    ul: ({ children }) => (
      <ul className="list-outside list-disc space-y-1 pl-5 text-mist">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="list-outside list-decimal space-y-1 pl-5 text-mist">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="pl-0.5 text-paper/90">{children}</li>,
    hr: () => <hr className="border-line" />,
    a: ({ href, children }) => {
      // remend placeholder for unfinished [text](url mid-stream
      if (!href || href === 'streamdown:incomplete-link') {
        return <span className="text-signal">{children}</span>;
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="interactive text-signal underline-offset-2 hover:underline"
        >
          {children}
        </a>
      );
    },
    table: ({ children }) => (
      <div className="overflow-x-auto rounded-[var(--radius-control)] border border-line">
        <table className="min-w-full border-collapse text-left text-sm">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="border-b border-line bg-ink/60">{children}</thead>
    ),
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => (
      <tr className="border-b border-line/70 last:border-0">{children}</tr>
    ),
    th: ({ children }) => (
      <th className="px-2.5 py-1.5 font-semibold text-paper">{children}</th>
    ),
    td: ({ children }) => (
      <td className="px-2.5 py-1.5 text-mist">{children}</td>
    ),
    // Unwrap so our `code` handler owns the fence chrome.
    pre: ({ children }) => <>{children}</>,
    code: ({ className, children }) => {
      const lang =
        /language-([A-Za-z0-9_+-]+)/.exec(className ?? '')?.[1] ?? null;
      const text = String(children).replace(/\n$/, '');
      // Fenced blocks get language-* or include newlines; inline is single-line.
      const isFence = Boolean(lang) || text.includes('\n');

      if (isFence) {
        return (
          <CodeBlock
            text={text}
            language={lang}
            saveContext={saveContext}
            streaming={streaming}
          />
        );
      }

      return (
        <code className="rounded bg-ink/80 px-1 py-0.5 font-mono text-[0.9em] text-signal">
          {children}
        </code>
      );
    },
  };
}

const MarkdownBlock = memo(
  function MarkdownBlock({
    content,
    saveContext,
    streaming,
  }: {
    content: string;
    saveContext?: SaveContext;
    streaming?: boolean;
  }) {
    const components = useMemo(
      () => createMarkdownComponents(saveContext, streaming),
      [saveContext, streaming],
    );

    return (
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {content}
      </ReactMarkdown>
    );
  },
  (prev, next) =>
    prev.content === next.content &&
    prev.streaming === next.streaming &&
    prev.saveContext?.projectId === next.saveContext?.projectId &&
    prev.saveContext?.sessionId === next.saveContext?.sessionId,
);

export function MarkdownContent({
  text,
  streaming = false,
  saveContext,
}: MarkdownContentProps) {
  const [, startTransition] = useTransition();
  const prepared = useMemo(
    () => prepareMarkdown(text, streaming),
    [text, streaming],
  );
  const blocks = useMemo(() => splitIntoBlocks(prepared), [prepared]);
  const [displayBlocks, setDisplayBlocks] = useState<string[]>(blocks);

  useEffect(() => {
    if (streaming) {
      startTransition(() => setDisplayBlocks(blocks));
    } else {
      setDisplayBlocks(blocks);
    }
  }, [blocks, streaming, startTransition]);

  return (
    <div className="chat-md space-y-3 text-[15px] leading-relaxed text-paper/90">
      {displayBlocks.map((block, i) => (
        <MarkdownBlock
          key={`md-${i}`}
          content={block}
          saveContext={saveContext}
          streaming={streaming}
        />
      ))}
      {streaming ? (
        <span
          className="inline-block h-4 w-0.5 animate-pulse bg-signal align-middle"
          aria-hidden
        />
      ) : null}
    </div>
  );
}

export type { MarkdownContentProps, SaveContext };
