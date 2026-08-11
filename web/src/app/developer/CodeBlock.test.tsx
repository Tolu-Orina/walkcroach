// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CodeBlock } from './CodeBlock';

afterEach(cleanup);

describe('CodeBlock', () => {
  it('copies snippet to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(<CodeBlock>{'npm install @walkcroach/sdk'}</CodeBlock>);
    await userEvent.click(screen.getByRole('button', { name: /Copy/i }));
    expect(writeText).toHaveBeenCalledWith('npm install @walkcroach/sdk');
    expect(screen.getByRole('button', { name: /Copied/i })).toBeTruthy();
  });
});
