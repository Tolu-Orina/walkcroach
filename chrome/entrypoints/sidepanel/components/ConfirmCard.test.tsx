// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmCard, humanise } from './ConfirmCard';

afterEach(cleanup);

const noop = () => undefined;

describe('humanise', () => {
  it('turns field keys into readable labels', () => {
    expect(humanise('productName')).toBe('Product name');
    expect(humanise('product_name')).toBe('Product name');
    expect(humanise('candidate-email')).toBe('Candidate email');
    expect(humanise('price')).toBe('Price');
  });
});

describe('ConfirmCard — editable proposal', () => {
  it('renders one labelled input per proposed field', () => {
    render(
      <ConfirmCard
        title="Save these details?"
        fields={{ productName: 'M4 bracket', price: '3.15' }}
        onConfirm={noop}
        onDismiss={noop}
      />,
    );
    expect(screen.getByLabelText('Product name')).toHaveValue('M4 bracket');
    expect(screen.getByLabelText('Price')).toHaveValue('3.15');
  });

  it('reports edits so the user can correct the model before any write', async () => {
    const onFieldChange = vi.fn();
    render(
      <ConfirmCard
        title="Save these details?"
        fields={{ price: '3.15' }}
        onFieldChange={onFieldChange}
        onConfirm={noop}
        onDismiss={noop}
      />,
    );
    await userEvent.type(screen.getByLabelText('Price'), '9');
    expect(onFieldChange).toHaveBeenCalledWith('price', '3.159');
  });
});

describe('ConfirmCard — read-only summary', () => {
  it('shows exactly what will be written', () => {
    render(
      <ConfirmCard
        title="Save this page?"
        summary={[
          { label: 'Page', value: 'Supplier quote Q-4471' },
          { label: 'Into', value: 'Suppliers' },
        ]}
        onConfirm={noop}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText('Supplier quote Q-4471')).toBeInTheDocument();
    expect(screen.getByText('Suppliers')).toBeInTheDocument();
    // Nothing editable in this shape.
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('ConfirmCard — the write gate', () => {
  it('executes only on explicit confirm', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmCard
        title="Save this page?"
        confirmLabel="Save page"
        onConfirm={onConfirm}
        onDismiss={noop}
      />,
    );
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Save page' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('discards without writing', async () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ConfirmCard title="Save?" onConfirm={onConfirm} onDismiss={onDismiss} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('submits on Enter from a field, so keyboard users are not stranded', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmCard
        title="Save?"
        fields={{ price: '1.00' }}
        onConfirm={onConfirm}
        onDismiss={noop}
      />,
    );
    await userEvent.type(screen.getByLabelText('Price'), '{Enter}');
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('cannot double-execute while a write is in flight', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmCard
        title="Save?"
        busy
        confirmLabel="Save page"
        onConfirm={onConfirm}
        onDismiss={noop}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Saving…' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('locks the fields while committing so the payload cannot change mid-write', () => {
    render(
      <ConfirmCard
        title="Save?"
        busy
        fields={{ price: '1.00' }}
        onConfirm={noop}
        onDismiss={noop}
      />,
    );
    expect(screen.getByLabelText('Price')).toBeDisabled();
  });

  it('is announced as a named form region', () => {
    render(<ConfirmCard title="Save this page?" onConfirm={noop} onDismiss={noop} />);
    expect(
      screen.getByRole('form', { name: 'Save this page?' }),
    ).toBeInTheDocument();
  });
});
