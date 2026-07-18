/**
 * Coalesce TOKEN_DELTA text for ~16ms active-session flushes (impl plan §2.2 / §7).
 * Host bridges call `push` on every engine token; UI receives batched deltas.
 */

export type CoalesceFlush = (text: string) => void;

export class TokenDeltaCoalescer {
  private buffer = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly intervalMs: number;
  private readonly flushFn: CoalesceFlush;

  constructor(flushFn: CoalesceFlush, intervalMs = 16) {
    this.flushFn = flushFn;
    this.intervalMs = intervalMs;
  }

  push(text: string): void {
    if (!text) return;
    this.buffer += text;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => this.flushNow(), this.intervalMs);
  }

  /** Force immediate flush (e.g. before DONE / ERROR / non-token events). */
  flushNow(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.buffer) return;
    const text = this.buffer;
    this.buffer = '';
    this.flushFn(text);
  }

  dispose(): void {
    this.flushNow();
  }
}
