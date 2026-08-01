// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Stream } from './Stream';

afterEach(cleanup);

const noop = () => undefined;

describe('Stream — output controls', () => {
  it('hides Insert and Copy mid-stream, so half a draft cannot be pasted', () => {
    render(<Stream text="Half a dr" streaming onInsert={noop} onCopy={noop} />);
    expect(screen.queryByRole('button', { name: 'Insert into page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  });

  it('offers Insert and Copy on a finished response', async () => {
    const onInsert = vi.fn();
    const onCopy = vi.fn();
    render(
      <Stream
        text="A complete draft."
        streaming={false}
        onInsert={onInsert}
        onCopy={onCopy}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Insert into page' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(onInsert).toHaveBeenCalledOnce();
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it('owns no cancel control — Stop lives in the docked composer, which cannot scroll away', () => {
    render(<Stream text="Generating" streaming onInsert={noop} onCopy={noop} />);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});

describe('Stream — rendering', () => {
  it('renders nothing at rest', () => {
    const { container } = render(<Stream text="" streaming={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the live region as soon as streaming starts, before any token', () => {
    render(<Stream text="" streaming />);
    expect(screen.getByRole('status').textContent).toMatch(/Generating/i);
  });

  it('preserves the streamed text verbatim', () => {
    render(<Stream text="Line one\nLine two" streaming={false} />);
    expect(screen.getByText(/Line one/)).toBeInTheDocument();
  });
});

describe('Stream — accessibility', () => {
  it('announces coarse status rather than every token', () => {
    // Announcing token-by-token floods a screen reader and makes the panel
    // unusable; the prose itself is navigable separately.
    const { rerender } = render(<Stream text="Nor" streaming />);
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live.textContent).toMatch(/Generating/i);

    rerender(<Stream text="Northwind." streaming={false} />);
    expect(screen.getByRole('status').textContent).toMatch(/complete/i);
  });

  it('hides the caret from assistive tech and drops it when done', () => {
    const { container, rerender } = render(<Stream text="Nor" streaming />);
    const caret = container.querySelector('.wc-stream__caret');
    expect(caret).not.toBeNull();
    expect(caret).toHaveAttribute('aria-hidden', 'true');

    rerender(<Stream text="Northwind." streaming={false} />);
    expect(container.querySelector('.wc-stream__caret')).toBeNull();
  });
});

describe('markdown rendering', () => {
  it('renders headings and emphasis as elements, not literal syntax', () => {
    // The bug this fixes: `### Summary` and `**bold**` reached the panel as
    // characters, because the container rendered raw text.
    render(<Stream text={'### Summary\n\n**Program Overview**'} streaming={false} />);

    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Summary');
    expect(screen.getByText('Program Overview').tagName).toBe('STRONG');
    expect(screen.queryByText(/###/)).toBeNull();
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it('renders bullets as a real list', () => {
    render(<Stream text={'- one\n- two\n- three'} streaming={false} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('does not execute raw HTML in model output', () => {
    // Load-bearing. This text derives from an arbitrary web page, so a
    // prompt-injected tag would otherwise run in the extension's own origin,
    // with reach into chrome.* and the user's session. react-markdown escapes
    // HTML unless rehype-raw is added; this fails the moment someone adds it.
    const { container } = render(
      <Stream
        text={'<img src=x onerror="globalThis.__pwned=1">\n\n<script>globalThis.__pwned=1</script>'}
        streaming={false}
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('opens model-supplied links without handing over the opener', () => {
    render(<Stream text="[coursera](https://www.coursera.org)" streaming={false} />);

    const link = screen.getByRole('link', { name: 'coursera' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('tolerates half-streamed markdown without dropping the text', () => {
    // Most frames mid-stream end on an unclosed token. Incomplete syntax must
    // degrade to literal characters, never to a blank panel.
    render(<Stream text={'### Summ'} streaming />);
    expect(screen.getByText(/Summ/)).toBeInTheDocument();

    cleanup();
    render(<Stream text={'a **bold stretch that has not clo'} streaming />);
    expect(screen.getByText(/bold stretch/)).toBeInTheDocument();
  });
});
