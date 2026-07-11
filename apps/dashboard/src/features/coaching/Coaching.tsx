/**
 * Coaching screen (spec): coaching overview + Prompt Coach.
 *
 * The overview surfaces top opportunities, improvements over time, repeated
 * behaviours, estimated avoidable usage (labelled estimated — never official
 * billing data,), and verification / prompt-quality / model-allocation
 * trends. The Prompt Coach lists recent prompts with deterministic quality
 * scores and a(assessment, suggested structure,
 * outcome-correlated comparison, recurring templates, baseline comparison).
 *
 * Every quality score is `heuristic` (deterministic structural signals); no
 * external model is invoked ( — external semantic analysis stays disabled
 * by default). The model catalogue is configurable — no hardcoded
 * permanent model claims, only relative tiers.
 */
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useCoachingOverview, useCoachingPrompts, useCoachingPrompt } from "../../hooks/useApi.js";
import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  ProvenanceTag,
  Spinner,
  Stat,
} from "../../components/ui/primitives.js";
import { ConfidenceBadge, Pagination } from "../../components/ui/widgets.js";
import { navigate } from "../../lib/router.js";
import {
  COST_ESTIMATE_LABEL,
  confidenceBand,
  confidenceLabel,
  formatCost,
  formatNumber,
  formatPct,
  formatRelative,
  formatTokens,
} from "../../lib/format.js";
import { cn } from "../../lib/cn.js";
import type { CoachingOverview, CoachingPromptListItem } from "../../lib/types.js";

export function Coaching() {
  const q = useCoachingOverview();
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Coaching</h2>
        <p className="text-sm text-[var(--al-text-secondary)]">
          Evidence-backed coaching from your local sessions. Quality scores are deterministic
          structural signals (heuristic) — no external model is used.
        </p>
      </div>

      {q.isLoading ? <Spinner label="Computing coaching overview" /> : null}
      {q.isError ? <ErrorState error={q.error} /> : null}
      {q.data ? <OverviewBody data={q.data} /> : null}

      <PromptCoachSection selected={selectedPrompt} onSelect={setSelectedPrompt} />
    </div>
  );
}

function OverviewBody({ data }: { data: CoachingOverview }) {
  const t = data.trends;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Stat
          label="Top opportunities"
          value={formatNumber(data.topOpportunities.length)}
          hint="active, evidence-backed"
        />
        <Stat
          label="Estimated avoidable tokens"
          value={
            data.estimatedAvoidableUsage.estimatedTokens !== null
              ? formatTokens(data.estimatedAvoidableUsage.estimatedTokens)
              : "—"
          }
          hint={<ProvenanceTag provenance="estimated" />}
        />
        <Stat
          label="Estimated avoidable cost"
          value={
            data.estimatedAvoidableUsage.estimatedCostUsd !== null
              ? formatCost(data.estimatedAvoidableUsage.estimatedCostUsd)
              : "—"
          }
          hint={COST_ESTIMATE_LABEL}
          tone="text-[var(--al-accent)]"
        />
        <Stat
          label="Verification rate"
          value={t.verificationRate !== null ? formatPct(t.verificationRate) : "—"}
          hint={<ProvenanceTag provenance={t.verificationProvenance} />}
        />
        <Stat
          label="Prompt quality"
          value={t.promptQualityScore !== null ? formatPct(t.promptQualityScore) : "—"}
          hint={<ProvenanceTag provenance={t.promptQualityProvenance} />}
        />
        <Stat
          label="Model-allocation findings"
          value={formatNumber(t.modelAllocationFindings)}
          hint="active model-* rules"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ImprovementsChart data={data} />
        <RepeatedBehavioursCard data={data} />
      </div>

      <TopOpportunitiesCard data={data} />

      <ModelCatalogueCard data={data} />
    </div>
  );
}

function ImprovementsChart({ data }: { data: CoachingOverview }) {
  const chartData = data.improvementsOverTime.map((p) => ({
    date: p.date.slice(5),
    count: p.count,
  }));
  return (
    <Card>
      <CardTitle>Improvements over time</CardTitle>
      <div className="mt-4 h-56">
        {chartData.length === 0 ? (
          <EmptyState title="No data">No recommendations recorded in the last 14 days.</EmptyState>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -8 }}>
              <defs>
                <linearGradient id="improvementBar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--al-accent)" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="var(--al-accent)" stopOpacity={0.55} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--al-border)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "var(--al-text-muted)", fontSize: 10 }}
                stroke="var(--al-border)"
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "var(--al-text-muted)", fontSize: 11 }}
                stroke="var(--al-border)"
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: "var(--al-bg-hover)", opacity: 0.4 }}
                contentStyle={{
                  background: "var(--al-bg-elevated)",
                  border: "1px solid var(--al-border)",
                  borderRadius: "var(--al-radius-lg)",
                  fontSize: 12,
                  color: "var(--al-text)",
                }}
              />
              <Bar dataKey="count" fill="url(#improvementBar)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="mt-3 text-xs text-[var(--al-text-muted)]">
        New active recommendations per day (last 14 days).
      </p>
    </Card>
  );
}

function RepeatedBehavioursCard({ data }: { data: CoachingOverview }) {
  const items = data.repeatedBehaviours;
  return (
    <Card>
      <CardTitle>Repeated behaviours</CardTitle>
      {items.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No repeated templates">
            No recurring prompt templates detected.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-4 space-y-3 text-sm">
          {items.map((t) => (
            <li
              key={t.templateKey}
              className="flex flex-col gap-1 rounded-[var(--al-radius-md)] bg-[var(--al-bg-inset)] p-3"
            >
              <span className="flex items-center gap-2">
                <Badge tone="accent">{t.occurrences}×</Badge>
                <span className="text-[var(--al-text-secondary)]">{t.sessions} sessions</span>
              </span>
              <span className="font-mono text-xs text-[var(--al-text-muted)]">
                {t.examplePrefix}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-[var(--al-text-muted)]">
        <ProvenanceTag provenance="heuristic" /> — deterministic template clustering.
      </p>
    </Card>
  );
}

function TopOpportunitiesCard({ data }: { data: CoachingOverview }) {
  const items = data.topOpportunities;
  return (
    <Card>
      <CardTitle>Top opportunities</CardTitle>
      {items.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No active opportunities">
            Run a scan to populate recommendations.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--al-border)] text-sm">
          {items.map((o) => {
            const band = confidenceBand(o.confidence);
            return (
              <li key={o.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={severityTone(o.severity)}>{o.severity}</Badge>
                    <Badge tone="accent">{o.category}</Badge>
                    <span className="font-mono text-xs text-[var(--al-text-muted)]">
                      {o.ruleId}
                    </span>
                  </div>
                  <p className="mt-1 font-medium text-[var(--al-text)]">{o.title}</p>
                  <p className="text-xs text-[var(--al-text-secondary)]">{o.summary}</p>
                  {o.sessionId ? (
                    <button
                      className="mt-1 text-xs font-medium text-[var(--al-accent)] hover:underline"
                      onClick={() => navigate("session", { id: o.sessionId ?? "" })}
                    >
                      View related session →
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <ConfidenceBadge confidence={o.confidence} />
                  <span className="text-xs text-[var(--al-text-muted)]">
                    {o.evidenceCount} evidence · {confidenceLabel(band)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ModelCatalogueCard({ data }: { data: CoachingOverview }) {
  const entries = data.modelCatalogue.entries;
  return (
    <Card>
      <CardTitle>Model catalogue (configurable)</CardTitle>
      <p className="mt-2 text-xs text-[var(--al-text-muted)]">
        Relative tiers only — no permanent “best/cheapest” claims. Overrides via config{" "}
        <span className="font-mono">analysis.modelCatalogue</span>. v{data.modelCatalogue.version}.
      </p>
      {entries.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No entries">No model catalogue entries configured.</EmptyState>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--al-border)] text-sm">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[var(--al-text)]">{e.id}</span>
                <Badge tone="neutral">{e.provider}</Badge>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-[var(--al-text-secondary)]">
                <span className="rounded-[var(--al-radius-md)] bg-[var(--al-bg-inset)] px-2 py-1">
                  capability {e.capabilityTier}/5
                </span>
                <span className="rounded-[var(--al-radius-md)] bg-[var(--al-bg-inset)] px-2 py-1">
                  cost {e.costTier}/5
                </span>
                <span className="rounded-[var(--al-radius-md)] bg-[var(--al-bg-inset)] px-2 py-1">
                  context {e.contextClass}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Prompt Coach                                                               */
/* -------------------------------------------------------------------------- */

function PromptCoachSection({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [page, setPage] = useState(1);
  const limit = 10;
  const q = useCoachingPrompts({ page, limit });
  const detail = useCoachingPrompt(selected);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold tracking-tight">Prompt Coach</h3>
        <p className="text-sm text-[var(--al-text-secondary)]">
          Deterministic prompt-quality scoring. Select a prompt for a structured comparison and
          suggested improvement.
        </p>
      </div>

      {q.isLoading ? <Spinner label="Loading prompts" /> : null}
      {q.isError ? <ErrorState error={q.error} /> : null}
      {q.data ? (
        q.data.items.length === 0 ? (
          <EmptyState title="No prompts">No prompts recorded yet.</EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="divide-y divide-[var(--al-border)] overflow-hidden rounded-[var(--al-radius-lg)] border border-[var(--al-border)] bg-[var(--al-bg-elevated)]">
              {q.data.items.map((p) => (
                <PromptRow
                  key={p.id}
                  prompt={p}
                  active={selected === p.id}
                  onSelect={() => onSelect(selected === p.id ? null : p.id)}
                />
              ))}
            </ul>
            <Pagination
              page={page}
              hasMore={q.data.hasMore}
              total={q.data.total}
              onChange={setPage}
            />
          </div>
        )
      ) : null}

      {selected ? (
        <div className="mt-2">
          {detail.isLoading ? <Spinner label="Loading prompt detail" /> : null}
          {detail.isError ? <ErrorState error={detail.error} /> : null}
          {detail.data ? <PromptDetail data={detail.data} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function PromptRow({
  prompt,
  active,
  onSelect,
}: {
  prompt: CoachingPromptListItem;
  active: boolean;
  onSelect: () => void;
}) {
  const band = confidenceBand(prompt.overallScore);
  return (
    <li>
      <button
        onClick={onSelect}
        aria-pressed={active}
        className={cn(
          "flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors",
          active ? "bg-[var(--al-accent-ghost)]" : "hover:bg-[var(--al-bg-hover)]",
        )}
      >
        <div className="min-w-0 text-left">
          <p className="font-mono text-xs text-[var(--al-text-muted)]">
            #{prompt.sequence} · {formatRelative(prompt.timestamp)} ·{" "}
            {prompt.approximateTokenCount ?? "?"} tok
          </p>
          <p className="truncate text-sm text-[var(--al-text)]">
            {prompt.redactedContent ?? (
              <span className="text-[var(--al-text-muted)]">content hidden by privacy mode</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ConfidenceBadge confidence={prompt.overallScore} />
          <span className="text-xs text-[var(--al-text-muted)]">{confidenceLabel(band)}</span>
        </div>
      </button>
    </li>
  );
}

function PromptDetail({
  data,
}: {
  data: NonNullable<ReturnType<typeof useCoachingPrompt>["data"]>;
}) {
  return (
    <Card className="border-l-4 border-l-[var(--al-accent)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Prompt detail #{data.sequence}</CardTitle>
        <button
          className="text-xs font-medium text-[var(--al-accent)] hover:underline"
          onClick={() => navigate("session", { id: data.sessionId })}
        >
          View session →
        </button>
      </div>

      {data.redactedContent ? (
        <pre className="mt-4 overflow-auto whitespace-pre-wrap rounded-[var(--al-radius-md)] border border-[var(--al-border)] bg-[var(--al-bg-inset)] p-3 text-xs text-[var(--al-text)]">
          {data.redactedContent}
        </pre>
      ) : (
        <p className="mt-4 text-sm text-[var(--al-text-muted)]">
          Content is hidden under the active privacy mode.
        </p>
      )}

      {data.assessment ? (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--al-text-muted)]">
            Quality dimensions
          </h4>
          <ul className="mt-3 space-y-2 text-sm">
            {data.assessment.dimensions.map((d) => (
              <li key={d.key} className="flex flex-col gap-1">
                <span className="flex justify-between">
                  <span className="text-[var(--al-text)]">{d.label}</span>
                  <span className="tabular-nums font-medium text-[var(--al-text)]">
                    {formatPct(d.score)}
                  </span>
                </span>
                <span className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--al-bg-inset)]">
                  <span
                    className="block h-full rounded-full bg-[var(--al-accent)]"
                    style={{ width: `${Math.round(d.score * 100)}%` }}
                  />
                </span>
                <span className="text-xs text-[var(--al-text-secondary)]">{d.rationale}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[var(--al-text-muted)]">
            Overall {formatPct(data.assessment.overallScore)} ·{" "}
            <ProvenanceTag provenance={data.assessment.provenance} />
          </p>
        </div>
      ) : null}

      {data.comparison ? (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-[var(--al-radius-md)] bg-[var(--al-bg-inset)] p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--al-text-muted)]">
              Outcome correlation
            </h4>
            <ul className="mt-2 space-y-1 text-sm text-[var(--al-text)]">
              {data.comparison.observedOutcome.map((o, i) => (
                <li key={i}>• {o}</li>
              ))}
            </ul>
            {data.comparison.ambiguities.length > 0 ? (
              <p className="mt-3 text-xs text-[var(--al-warning)]">
                Ambiguities: {data.comparison.ambiguities.join("; ")}
              </p>
            ) : null}
          </div>
          <div className="rounded-[var(--al-radius-md)] bg-[var(--al-bg-inset)] p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--al-text-muted)]">
              Suggested improvement
            </h4>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-[var(--al-radius-md)] border border-[var(--al-border)] bg-[var(--al-bg-elevated)] p-3 text-xs text-[var(--al-text)]">
              {data.comparison.suggestedImprovedPrompt}
            </pre>
            <p className="mt-2 text-xs text-[var(--al-text-muted)]">{data.comparison.disclaimer}</p>
          </div>
        </div>
      ) : null}

      {data.baselineComparison ? (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--al-text-muted)]">
            Baseline comparison
          </h4>
          <p className="mt-2 text-sm text-[var(--al-text)]">
            {data.baselineComparison.relativeDuration ?? "—"}{" "}
            <ProvenanceTag provenance={data.baselineComparison.provenance} />
          </p>
        </div>
      ) : null}

      {data.recurringTemplates.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--al-text-muted)]">
            Recurring templates
          </h4>
          <ul className="mt-2 space-y-1 text-sm text-[var(--al-text)]">
            {data.recurringTemplates.map((t) => (
              <li key={t.templateKey}>
                {t.occurrences}× across {t.sessions} session(s)
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function severityTone(sev: string): "neutral" | "low" | "medium" | "high" | "critical" | "info" {
  switch (sev) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    case "info":
      return "info";
    default:
      return "neutral";
  }
}
