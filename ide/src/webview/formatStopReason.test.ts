import { describe, expect, it } from 'vitest';
import { formatStopReason } from './formatStopReason';

describe('formatStopReason', () => {
  it('maps industry stop reasons to labels', () => {
    expect(formatStopReason('end_turn')).toBe('Complete');
    expect(formatStopReason('incomplete')).toBe('Incomplete · needs writes');
    expect(formatStopReason('max_tokens')).toBe('Truncated · output limit');
    expect(formatStopReason('max_iterations')).toBe(
      'Paused · tool-round limit',
    );
    expect(formatStopReason('cancelled')).toBe('Stopped');
  });
});
