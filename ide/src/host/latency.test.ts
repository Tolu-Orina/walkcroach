/**
 * Latency instrumentation — master plan §7E.
 *
 * The budgets (NFR-D01/02/03) were written in the PRD and measured nowhere.
 * The property that matters most here is that **unknown never reads as pass**:
 * an instrument that reports "within budget" before it has measured anything
 * is worse than no instrument, because it manufactures false confidence.
 */
import { describe, expect, it } from 'vitest';
import {
  LATENCY_BUDGETS,
  LatencyTracker,
  MAX_SAMPLES,
  formatLatencyReport,
  percentile,
} from './latency.js';

/** A tracker on a clock we control, so tests are not timing-dependent. */
function fakeClock() {
  let now = 0;
  return {
    tracker: new LatencyTracker(() => now),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('budgets', () => {
  it('match the PRD exactly', () => {
    // Drift between the document and the instrument would make every report
    // meaningless, so the numbers are pinned here.
    expect(LATENCY_BUDGETS.panelLoad).toMatchObject({
      id: 'NFR-D01',
      budgetMs: 1000,
      percentile: 50,
      level: 'MUST',
    });
    expect(LATENCY_BUDGETS.firstToken).toMatchObject({
      id: 'NFR-D02',
      budgetMs: 2500,
      percentile: 50,
      level: 'MUST',
    });
    expect(LATENCY_BUDGETS.memoryRecall).toMatchObject({
      id: 'NFR-D03',
      budgetMs: 1500,
      percentile: 95,
      level: 'SHOULD',
    });
  });
});

describe('percentile', () => {
  it('returns a value that was actually observed', () => {
    // Nearest-rank, not interpolated: "p95 was 1.6s" should name a real
    // request someone waited for.
    const sorted = [10, 20, 30, 40, 50];
    expect(sorted).toContain(percentile(sorted, 95));
    expect(percentile(sorted, 50)).toBe(30);
    expect(percentile(sorted, 100)).toBe(50);
  });

  it('handles a single sample and an empty set', () => {
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 50)).toBeNull();
  });

  it('clamps a nonsense percentile instead of returning undefined', () => {
    expect(percentile([1, 2, 3], -10)).toBe(1);
    expect(percentile([1, 2, 3], 999)).toBe(3);
  });
});

describe('measurement', () => {
  it('records the elapsed time between start and stop', () => {
    const { tracker, advance } = fakeClock();
    tracker.start('panelLoad');
    advance(750);
    expect(tracker.stop('panelLoad')).toBe(750);
    expect(tracker.report('panelLoad')).toMatchObject({
      samples: 1,
      observedMs: 750,
      withinBudget: true,
    });
  });

  it('keeps concurrent measurements of the same metric apart', () => {
    // Two panels loading at once must not overwrite each other's start.
    const { tracker, advance } = fakeClock();
    tracker.start('panelLoad', 'panel-a');
    advance(100);
    tracker.start('panelLoad', 'panel-b');
    advance(200);
    expect(tracker.stop('panelLoad', 'panel-a')).toBe(300);
    expect(tracker.stop('panelLoad', 'panel-b')).toBe(200);
  });

  it('returns null for a stop with no start rather than inventing a zero', () => {
    // A zero would silently improve every percentile it touched.
    const { tracker } = fakeClock();
    expect(tracker.stop('firstToken')).toBeNull();
    expect(tracker.report('firstToken').samples).toBe(0);
  });

  it('drops an abandoned measurement, because a cancelled run is not a slow one', () => {
    const { tracker, advance } = fakeClock();
    tracker.start('firstToken');
    advance(9000);
    tracker.abandon('firstToken');
    expect(tracker.stop('firstToken')).toBeNull();
    expect(tracker.report('firstToken').samples).toBe(0);
  });

  it('ignores impossible durations', () => {
    const { tracker } = fakeClock();
    tracker.record('panelLoad', -5);
    tracker.record('panelLoad', Number.NaN);
    tracker.record('panelLoad', Number.POSITIVE_INFINITY);
    expect(tracker.report('panelLoad').samples).toBe(0);
  });

  it('bounds memory over a long session', () => {
    const { tracker } = fakeClock();
    for (let i = 0; i < MAX_SAMPLES + 50; i += 1) tracker.record('firstToken', i);
    const report = tracker.report('firstToken');
    expect(report.samples).toBe(MAX_SAMPLES);
    // The window keeps the most recent samples, so a fixed early spike does
    // not haunt the percentile for the rest of the session.
    expect(report.maxMs).toBe(MAX_SAMPLES + 49);
  });
});

describe('verdicts', () => {
  it('reports "unknown" rather than "within budget" before measuring', () => {
    // The single most important property here: no data is not a pass.
    const { tracker } = fakeClock();
    for (const report of tracker.reportAll()) {
      expect(report.withinBudget, report.id).toBeNull();
      expect(report.observedMs, report.id).toBeNull();
    }
    expect(tracker.breaches()).toEqual([]);
  });

  it('flags a breach at the budget percentile, not at the mean', () => {
    // NFR-D03 is a p95 budget: nineteen fast recalls and one slow one is
    // within budget; a slow tail is what it exists to catch.
    const { tracker } = fakeClock();
    for (let i = 0; i < 19; i += 1) tracker.record('memoryRecall', 200);
    tracker.record('memoryRecall', 9000);
    expect(tracker.report('memoryRecall').withinBudget).toBe(true);

    // Make the tail genuinely slow and it breaches.
    for (let i = 0; i < 5; i += 1) tracker.record('memoryRecall', 9000);
    const report = tracker.report('memoryRecall');
    expect(report.withinBudget).toBe(false);
    expect(tracker.breaches().map((r) => r.id)).toContain('NFR-D03');
  });

  it('treats exactly-at-budget as within', () => {
    const { tracker } = fakeClock();
    tracker.record('panelLoad', LATENCY_BUDGETS.panelLoad.budgetMs);
    expect(tracker.report('panelLoad').withinBudget).toBe(true);
    tracker.record('panelLoad', LATENCY_BUDGETS.panelLoad.budgetMs + 1);
    // p50 of [1000, 1001] is 1000 — still within.
    expect(tracker.report('panelLoad').withinBudget).toBe(true);
  });

  it('reports every budget, so a silent metric is visible as unmeasured', () => {
    const { tracker } = fakeClock();
    tracker.record('panelLoad', 100);
    const all = tracker.reportAll();
    expect(all).toHaveLength(Object.keys(LATENCY_BUDGETS).length);
    expect(all.find((r) => r.metric === 'firstToken')?.samples).toBe(0);
  });
});

describe('formatLatencyReport', () => {
  it('names each budget by its PRD id and its verdict', () => {
    const { tracker } = fakeClock();
    tracker.record('panelLoad', 400);
    tracker.record('firstToken', 5000);
    const text = formatLatencyReport(tracker.reportAll());

    expect(text).toContain('NFR-D01');
    expect(text).toContain('within');
    expect(text).toContain('NFR-D02');
    expect(text).toContain('OVER BUDGET');
    expect(text).toContain('no data');
  });

  it('says so plainly when nothing has been measured', () => {
    const { tracker } = fakeClock();
    expect(formatLatencyReport(tracker.reportAll())).toMatch(/No measurements yet/);
  });
});

describe('reset', () => {
  it('clears samples and in-flight measurements', () => {
    const { tracker } = fakeClock();
    tracker.start('panelLoad');
    tracker.record('firstToken', 100);
    tracker.reset();
    expect(tracker.report('firstToken').samples).toBe(0);
    expect(tracker.stop('panelLoad')).toBeNull();
  });
});
