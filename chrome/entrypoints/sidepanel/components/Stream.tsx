import { useEffect, useRef } from 'react';

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
        {text}
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
            Copy
          </button>
        )}
      </div>

      <div ref={endRef} />
    </div>
  );
}
