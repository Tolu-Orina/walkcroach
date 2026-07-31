/**
 * Latency instrumentation against the IDE PRD's budgets — master plan §7E.
 *
 * NFR-D01 (MUST)   webview panel loads within 1s of the sidebar icon
 * NFR-D02 (MUST)   first streamed token within 2.5s at p50
 * NFR-D03 (SHOULD) `recall_project_memory` within 1.5s at p95
 *
 * These were written in the PRD and never measured anywhere in code, which
 * means nobody would know if the extension quietly regressed. This module is
 * the measurement half; §9's Platform Ops Portal is where alerting will
 * consume it once that exists.
 *
 * ## Why percentiles, not averages
 *
 * The budgets are written as p50 and p95 because that is how latency actually
 * behaves: a mean hides the slow tail that users notice. Samples are kept in a
 * small ring buffer so a long session cannot grow this without bound.
 *
 * ## What is deliberately not here
 *
 * No timing is sent anywhere. Measurement is local and readable through a
 * command; shipping it off the machine would be telemetry, which the CLI
 * plan's P6 rules out and which nothing here has consent for.
 */

/** The three budgets, named as the PRD names them. */
export const LATENCY_BUDGETS = {
  /** NFR-D01: sidebar click → webview ready. */
  panelLoad: { id: 'NFR-D01', budgetMs: 1000, percentile: 50, level: 'MUST' },
  /** NFR-D02: task submitted → first streamed token. */
  firstToken: { id: 'NFR-D02', budgetMs: 2500, percentile: 50, level: 'MUST' },
  /** NFR-D03: recall_project_memory round trip. */
  memoryRecall: { id: 'NFR-D03', budgetMs: 1500, percentile: 95, level: 'SHOULD' },
} as const;

export type LatencyMetric = keyof typeof LATENCY_BUDGETS;

export type LatencyReport = {
  metric: LatencyMetric;
  /** PRD identifier, so a report can be read against the document. */
  id: string;
  level: 'MUST' | 'SHOULD';
  samples: number;
  budgetMs: number;
  percentile: number;
  /** The measured value at the budget's own percentile. */
  observedMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  /** null when there is nothing to judge yet — not a pass. */
  withinBudget: boolean | null;
};

/** Keep recent history bounded; a long session must not grow this forever. */
export const MAX_SAMPLES = 200;

/**
 * Nearest-rank percentile.
 *
 * Chosen over interpolation because it always returns a value that was
 * actually observed — "the p95 was 1.6s" should name a real request someone
 * waited for, not an average of two.
 */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const clamped = Math.min(100, Math.max(0, p));
  const rank = Math.ceil((clamped / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)] ?? null;
}

export class LatencyTracker {
  private readonly samples = new Map<LatencyMetric, number[]>();
  private readonly started = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * Begin timing. The key allows several concurrent measurements of the same
   * metric — two panels loading at once must not overwrite each other's start.
   */
  start(metric: LatencyMetric, key = 'default'): void {
    this.started.set(`${metric}:${key}`, this.now());
  }

  /**
   * Finish timing and record the sample.
   *
   * Returns the duration, or null when there was no matching `start` — a
   * stop without a start is a bug in the caller, and inventing a zero would
   * silently improve every percentile.
   */
  stop(metric: LatencyMetric, key = 'default'): number | null {
    const id = `${metric}:${key}`;
    const startedAt = this.started.get(id);
    if (startedAt === undefined) return null;
    this.started.delete(id);
    const duration = Math.max(0, this.now() - startedAt);
    this.record(metric, duration);
    return duration;
  }

  /** Discard an in-flight measurement — a cancelled run is not a slow one. */
  abandon(metric: LatencyMetric, key = 'default'): void {
    this.started.delete(`${metric}:${key}`);
  }

  record(metric: LatencyMetric, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const list = this.samples.get(metric) ?? [];
    list.push(durationMs);
    if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
    this.samples.set(metric, list);
  }

  report(metric: LatencyMetric): LatencyReport {
    const budget = LATENCY_BUDGETS[metric];
    const sorted = [...(this.samples.get(metric) ?? [])].sort((a, b) => a - b);
    const observedMs = percentile(sorted, budget.percentile);
    return {
      metric,
      id: budget.id,
      level: budget.level,
      samples: sorted.length,
      budgetMs: budget.budgetMs,
      percentile: budget.percentile,
      observedMs,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      maxMs: sorted.length ? sorted[sorted.length - 1]! : null,
      // No samples means unknown, and unknown must not read as a pass.
      withinBudget: observedMs === null ? null : observedMs <= budget.budgetMs,
    };
  }

  reportAll(): LatencyReport[] {
    return (Object.keys(LATENCY_BUDGETS) as LatencyMetric[]).map((m) => this.report(m));
  }

  /** Anything measured and over budget. Unknown metrics are not breaches. */
  breaches(): LatencyReport[] {
    return this.reportAll().filter((r) => r.withinBudget === false);
  }

  reset(): void {
    this.samples.clear();
    this.started.clear();
  }
}

/** One line per budget, for the output channel. */
export function formatLatencyReport(reports: LatencyReport[]): string {
  const lines = ['WalkCroach IDE — latency against the PRD budgets', ''];
  for (const r of reports) {
    const verdict =
      r.withinBudget === null ? 'no data' : r.withinBudget ? 'within' : 'OVER BUDGET';
    const observed = r.observedMs === null ? '—' : `${Math.round(r.observedMs)}ms`;
    lines.push(
      `${r.id} ${r.level.padEnd(6)} ${r.metric.padEnd(13)} ` +
        `p${r.percentile} ${observed.padStart(7)} / ${r.budgetMs}ms  ` +
        `(${r.samples} samples)  ${verdict}`,
    );
  }
  if (reports.every((r) => r.samples === 0)) {
    lines.push('', 'No measurements yet — open the panel and run a task.');
  }
  return lines.join('\n');
}
