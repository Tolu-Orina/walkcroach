import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Props = {
  text: string;
  className?: string;
};

/** Assistant markdown via react-markdown (React elements; no raw HTML). */
export function MarkdownBody({ text, className }: Props) {
  if (!text.trim()) {
    return <div className={className || 'bubble-body md'} />;
  }

  return (
    <div className={className || 'bubble-body md'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={href} rel="noreferrer noopener">
              {children}
            </a>
          ),
          pre: ({ children }) => <pre className="md-code">{children}</pre>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
