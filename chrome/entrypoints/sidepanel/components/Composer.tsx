import { useEffect, useRef } from 'react';

/**
 * Bottom-docked composer.
 *
 * Anchored in the shell grid rather than the scrolling content, for three
 * reasons that all bit the previous top-mounted layout:
 *
 *  1. Streamed output grows downward. With the input above it, new text pushes
 *     away from the control you type into; docked below, output arrives directly
 *     above the caret and eye and hand stay together.
 *  2. Asking is a *repeated* action. In the scroll region the field slid off
 *     screen after a long summary, so a follow-up meant scrolling back up.
 *  3. Cancel has to stay reachable. Stop used to live with the stream and could
 *     scroll away mid-generation; here the send control becomes Stop, the
 *     convention every chat surface uses.
 *
 * One composer serves the whole panel, relabelled per pane — Page asks about the
 * page, Recall asks the memory. Panes with nothing to ask render none.
 *
 * The send control is deliberately *not* amber. Amber marks exactly one action per
 * screen — the page verb, or a pending write — and a permanently docked send
 * button competing with it would break that. The focused field and its enabled
 * state carry the affordance instead.
 */
export function Composer({
  value,
  placeholder,
  label,
  submitLabel,
  streaming,
  disabled,
  autoFocus = false,
  webSearch,
  onWebSearchChange,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string;
  placeholder: string;
  /** Accessible name — the field has no visible label at this width. */
  label: string;
  submitLabel: string;
  streaming: boolean;
  disabled?: boolean;
  /**
   * Only for panes whose sole job is querying (Recall). Never on Page: stealing
   * focus on mount would jump a screen reader straight past the context header
   * and the site-access notice, which is the most important thing on screen.
   */
  autoFocus?: boolean;
  /** Omit to hide the web-search toggle (it only modifies Ask). */
  webSearch?: boolean;
  onWebSearchChange?: (v: boolean) => void;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (autoFocus && !disabled) ref.current?.focus();
  }, [autoFocus, disabled]);

  const canSubmit = !disabled && !streaming && value.trim().length > 0;

  return (
    <div className="wc-composer">
      {onWebSearchChange && (
        <label className="wc-toggle wc-composer__opt">
          <input
            type="checkbox"
            checked={Boolean(webSearch)}
            disabled={disabled}
            onChange={(e) => onWebSearchChange(e.target.checked)}
          />
          <span>Include web search</span>
        </label>
      )}

      <div className="wc-composer__row">
        <label className="wc-sr-only" htmlFor="wc-composer-input">
          {label}
        </label>
        <textarea
          id="wc-composer-input"
          ref={ref}
          className="wc-composer__input"
          rows={1}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line — chat convention. IME
            // composition must not be interrupted mid-character.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSubmit) onSubmit();
            }
          }}
        />

        {streaming && onCancel ? (
          <button
            type="button"
            className="wc-btn wc-composer__send"
            onClick={onCancel}
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="wc-btn wc-composer__send"
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {submitLabel}
          </button>
        )}
      </div>
    </div>
  );
}
