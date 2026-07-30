// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from './Composer';

afterEach(cleanup);

const noop = () => undefined;

const base = {
  placeholder: 'Ask about this page…',
  label: 'Ask about this page',
  submitLabel: 'Ask',
  streaming: false,
  onChange: noop,
  onSubmit: noop,
};

describe('Composer — submitting', () => {
  it('sends on Enter, the convention every chat surface uses', async () => {
    const onSubmit = vi.fn();
    render(<Composer {...base} value="what is the lead time?" onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(base.label), '{Enter}');
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('breaks the line on Shift+Enter instead of sending', async () => {
    const onSubmit = vi.fn();
    render(<Composer {...base} value="line one" onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(base.label), '{Shift>}{Enter}{/Shift}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses to send an empty or whitespace-only question', async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<Composer {...base} value="" onSubmit={onSubmit} />);
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(base.label), '{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(<Composer {...base} value="   " onSubmit={onSubmit} />);
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
  });

  it('sends on click', async () => {
    const onSubmit = vi.fn();
    render(<Composer {...base} value="hello" onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe('Composer — cancellation', () => {
  it('turns the send control into Stop while generating', async () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(
      <Composer
        {...base}
        value="hello"
        streaming
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    // One control, two states — the panel never shows Ask and Stop at once.
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('will not fire a second request mid-stream', async () => {
    const onSubmit = vi.fn();
    render(
      <Composer {...base} value="hello" streaming onSubmit={onSubmit} onCancel={noop} />,
    );
    await userEvent.type(screen.getByLabelText(base.label), '{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('Composer — per-pane configuration', () => {
  it('takes its wording from the caller, so one composer serves every pane', () => {
    render(
      <Composer
        {...base}
        value=""
        placeholder="What did I save about…"
        label="Search your saved captures"
        submitLabel="Recall"
      />,
    );
    expect(
      screen.getByPlaceholderText('What did I save about…'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Recall' }),
    ).toBeInTheDocument();
  });

  it('hides the web-search toggle when the pane has no use for it', () => {
    render(<Composer {...base} value="" />);
    expect(screen.queryByLabelText(/web search/i)).toBeNull();
  });

  it('shows the web-search toggle only where it applies', async () => {
    const onWebSearchChange = vi.fn();
    render(
      <Composer
        {...base}
        value=""
        webSearch={false}
        onWebSearchChange={onWebSearchChange}
      />,
    );
    await userEvent.click(screen.getByLabelText(/web search/i));
    expect(onWebSearchChange).toHaveBeenCalledWith(true);
  });

  it('locks the field when the pane cannot be acted on', () => {
    render(<Composer {...base} value="" disabled />);
    expect(screen.getByLabelText(base.label)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
  });
});

describe('Composer — accessibility', () => {
  it('names the field without spending a visible label at 250px', () => {
    render(<Composer {...base} value="" />);
    // A placeholder alone is not an accessible name.
    expect(screen.getByLabelText(base.label).tagName).toBe('TEXTAREA');
  });

  it('does not steal focus on mount — that would skip the access notice', () => {
    render(<Composer {...base} value="" />);
    expect(screen.getByLabelText(base.label)).not.toHaveFocus();
  });

  it('takes focus only where the pane exists to be queried', () => {
    render(<Composer {...base} value="" autoFocus />);
    expect(screen.getByLabelText(base.label)).toHaveFocus();
  });

  it('leaves the amber CTA to the page action, not the send button', () => {
    render(<Composer {...base} value="hello" />);
    // One amber per screen: the page verb owns it.
    expect(
      screen.getByRole('button', { name: 'Ask' }).className,
    ).not.toContain('wc-btn--primary');
  });
});
