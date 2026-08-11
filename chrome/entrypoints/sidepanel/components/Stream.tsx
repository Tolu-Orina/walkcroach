import { useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Streamed model output.
 *
 * Accessibility: the region is `aria-live="polite"` but token-by-token updates
 * would flood a screen reader, so the live region carries a *coarse* status
 * ("Generating…" / "Response complete") while the prose itself sits in a plain
 * container the user can navigate at their own pace. Announcing every token is
 * the common mistake here and makes the panel unusable with a reader.
 *
 * Auto-scroll sticks to the bottom only while the user is already there, so
 * scrolling up to read does not fight the stream.
 *
 * Cancellation is not here: Stop belongs to the docked composer, where it cannot
 * scroll out of reach mid-generation.
 *
 * Markdown: the model emits headings, bold and lists, which used to reach the
 * user as literal `###` and `**`. Rendered with react-markdown, which does NOT
 * pass raw HTML through by default — deliberately left that way. This text is
 * model output derived from an arbitrary web page, so a prompt-injected
 * `<img onerror=…>` would otherwise execute inside the extension's own origin,
 * where it can reach `chrome.*` APIs and the user's session. Never add
 * rehype-raw here.
 *
 * Streaming means half-parsed markdown on most frames — an unclosed `**` or a
 * partial list. remark handles that fine, treating incomplete syntax as
 * literal text until the closing token arrives.
 */
export function Stream({
  text,
  streaming,
  onInsert,
  onCopy,
}: {
  text: string;
  streaming: boolean;
  onInsert?: () => void;
  onCopy?: () => void;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const scroller = endRef.current?.closest('.wc-main');
    if (!scroller) return;
    const onScroll = () => {
      const slack = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      stickRef.current = slack < 48;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (streaming && stickRef.current) {
      endRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [text, streaming]);

  if (!text && !streaming) return null;

  return (
    <div className="wc-section">
      <span className="wc-sr-only" role="status" aria-live="polite">
        {streaming ? 'Generating a response…' : 'Response complete'}
      </span>

      <div className="wc-stream">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Links open in a new tab and cannot reach back into the opener.
            // The href comes from model output, so it is untrusted.
            a: ({ node: _node, ...props }) => (
              <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
            ),
          }}
        >
          {text}
        </Markdown>
        {streaming && <span className="wc-stream__caret" aria-hidden="true" />}
      </div>

      <div className="wc-stream__tools">
        {!streaming && text && onInsert && (
          <button type="button" className="wc-btn wc-btn--ghost" onClick={onInsert}>
            Insert into page
          </button>
        )}
        {!streaming && text && onCopy && (
          <button type="button" className="wc-btn wc-btn--ghost" onClick={onCopy}>
            Copy response
          </button>
        )}
      </div>

      <div ref={endRef} />
    </div>
  );
}
