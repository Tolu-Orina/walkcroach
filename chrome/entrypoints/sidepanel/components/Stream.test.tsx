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
