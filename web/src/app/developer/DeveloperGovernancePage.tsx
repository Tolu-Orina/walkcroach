/**
 * Loom-inspired governance checklist for platform operators (Pre–Phase 6).
 *
 * Policy-only by design — not a control-plane product. Live usage and keys
 * stay on Overview / Ops / API keys. This page documents publish/scopes/
 * HITL/cost attribution before Phase 6 public agent package.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { getSdkHealth } from '../../api/client';

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="surface space-y-3 p-5">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function DeveloperGovernancePage() {
  const [asOfHuman, setAsOfHuman] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSdkHealth()
      .then((h) => {
        if (!cancelled) setAsOfHuman(h.retention?.asOfHuman ?? null);
      })
      .catch(() => {
        if (!cancelled) setAsOfHuman(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-mist">
        Patterns borrowed from enterprise agent platforms (e.g. AWS Loom) —
        applied to WalkCroach without forking their control plane. Memory stays
        on <code className="font-mono text-[12px] text-paper">/v1</code>; agent
        loops stay private until Phase 6 triggers. For live meters, use{' '}
        <Link to="/app/developer/ops" className="text-signal hover:underline">
          Ops
        </Link>
        .
      </p>

      <Section title="1. Registry / review before publish">
        <ul className="list-disc space-y-2 pl-5 text-sm text-mist">
          <li>
            Mint keys with least privilege on{' '}
            <Link to="/app/developer/keys" className="text-signal hover:underline">
              API keys
            </Link>
            : prefer <code className="font-mono text-[12px]">memory:read</code>{' '}
            / <code className="font-mono text-[12px]">memory:write</code>; add{' '}
            <code className="font-mono text-[12px]">content:run</code> only for
            publish workers.
          </li>
          <li>
            Content publish requires an explicit{' '}
            <code className="font-mono text-[12px]">writeScope</code> (
            <code className="font-mono text-[12px]">additive</code> for customer
            repos). No silent default.
          </li>
          <li>
            Prefer <code className="font-mono text-[12px]">dryRun: true</code>{' '}
            in staging before opening a real PR.
          </li>
          <li>
            Pass an <code className="font-mono text-[12px]">idempotencyKey</code>{' '}
            so retries cannot double-publish.
          </li>
        </ul>
      </Section>

      <Section title="2. Tag / cost attribution">
        <ul className="list-disc space-y-2 pl-5 text-sm text-mist">
          <li>
            Usage and key aggregates live on{' '}
            <Link to="/app/developer/ops" className="text-signal hover:underline">
              Ops
            </Link>
            — credit pool, ledger rates, and per-key remember/recall/publish.
          </li>
          <li>
            Ledger debits emit optional Stripe Billing Meter events (
            <code className="font-mono text-[12px]">walkcroach_credits</code>)
            with <code className="font-mono text-[12px]">usage_ledger.id</code>{' '}
            idempotency.
          </li>
          <li>
            Attribute cost by project + owner in CRDB; do not store secrets in
            portal deploy forms — Secrets Manager / env only.
          </li>
        </ul>
      </Section>

      <Section title="3. Config-driven deploy (no runtime codegen)">
        <ul className="list-disc space-y-2 pl-5 text-sm text-mist">
          <li>
            Programmatic runs use sdk-host policy +{' '}
            <code className="font-mono text-[12px]">WriteScope</code> — pre-written
            agent loop, injected configuration only.
          </li>
          <li>
            Content workers run on an in-memory FS (no E2B exec). Interactive
            Web/Chrome sandboxes keep E2B for isolation.
          </li>
          <li>
            Stdio MCP is refused in sdk-host; public MCP is HTTP via{' '}
            <code className="font-mono text-[12px]">@walkcroach/sdk-mcp</code>.
          </li>
        </ul>
      </Section>

      <Section title="4. Human-in-the-loop patterns">
        <ul className="list-disc space-y-2 pl-5 text-sm text-mist">
          <li>
            <strong className="font-medium text-paper">Content runs:</strong>{' '}
            LangGraph-style <code className="font-mono text-[12px]">interrupt</code>{' '}
            / <code className="font-mono text-[12px]">resume</code> on{' '}
            <code className="font-mono text-[12px]">POST /v1/runs/&#123;id&#125;/resume</code>{' '}
            (<code className="font-mono text-[12px]">threadId</code> = run id).
          </li>
          <li>
            <strong className="font-medium text-paper">Harness (Web):</strong>{' '}
            <code className="font-mono text-[12px]">awaiting_tool</code> /{' '}
            <code className="font-mono text-[12px]">awaiting_plan_approval</code>{' '}
            → map to interrupt kinds <code className="font-mono text-[12px]">tool_result</code>{' '}
            / <code className="font-mono text-[12px]">plan_decision</code>.
          </li>
          <li>
            <strong className="font-medium text-paper">Engine (IDE/CLI):</strong>{' '}
            in-process approvals + Claude-style{' '}
            <code className="font-mono text-[12px]">permissionMode</code>{' '}
            (<code className="font-mono text-[12px]">default</code> /{' '}
            <code className="font-mono text-[12px]">acceptEdits</code> /{' '}
            <code className="font-mono text-[12px]">plan</code>). Hard infra gates
            never bypass.
          </li>
        </ul>
      </Section>

      <Section title="5. Observability">
        <ul className="list-disc space-y-2 pl-5 text-sm text-mist">
          <li>
            Agent TelemetrySink emits GenAI-shaped events; optional OTEL / LangSmith
            / Langfuse sinks via env (
            <code className="font-mono text-[12px]">OTEL_EXPORTER_OTLP_ENDPOINT</code>,{' '}
            <code className="font-mono text-[12px]">LANGSMITH_API_KEY</code>,{' '}
            <code className="font-mono text-[12px]">LANGFUSE_*</code>).
          </li>
          <li>
            Memory path CloudWatch alarms:{' '}
            <code className="font-mono text-[12px]">WalkCroach/Memory</code> — see
            Ops (documented pointer, not live polling).
          </li>
          <li>
            asOf / diff retention window:{' '}
            <span className="font-mono text-paper">
              {asOfHuman ?? 'load from sdk-health…'}
            </span>{' '}
            — not multi-year time travel.
          </li>
          <li>We do not host a LangSmith competitor; export only.</li>
        </ul>
      </Section>

      <p className="text-[12px] text-mist">
        Full research:{' '}
        <code className="font-mono">docs/research/agentic-frameworks-landscape-2026.md</code>
        . Phase 6 public <code className="font-mono">@walkcroach/agent</code> remains
        gated.
      </p>
    </div>
  );
}
