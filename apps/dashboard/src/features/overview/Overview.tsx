/**
 * Overview screen (spec). Surfaces the high-level analytics snapshot with
 * honest-metric provenance tags and the mandatory cost estimate caveat.
 */
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMetrics } from "../../hooks/useApi.js";
import {
  COST_ESTIMATE_LABEL,
  confidenceLabel,
  confidenceBand,
  formatCost,
  formatDuration,
  formatNumber,
  formatPct,
  formatProvenanced,
  formatTokens,
} from "../../lib/format.js";
import { cn } from "../../lib/cn.js";
import {
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  Spinner,
  Stat,
  ProvenanceTag,
} from "../../components/ui/primitives.js";
import type { AnalyticsSnapshot } from "../../lib/types.js";

const PERIODS = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "all", label: "All time" },
];

const COMPLETION_COLORS: Record<string, string> = {
  completed: "var(--al-success)",
  interrupted: "var(--al-warning)",
  failed: "var(--al-danger)",
  unknown: "var(--al-text-muted)",
};

export function Overview() {
  const [period, setPeriod] = useState("week");
  const q = useMetrics({ period });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
          <p className="text-sm text-[var(--al-text-secondary)]">
            Aggregate usage and behaviour across your local sessions.
          </p>
        </div>
        <div className="flex gap-1 rounded-[var(--al-radius-lg)] border border-[var(--al-border)] bg-[var(--al-bg-elevated)] p-1 shadow-[var(--al-shadow-sm)]">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              aria-pressed={period === p.key}
              className={cn(
                "rounded-[var(--al-radius-md)] px-3 py-1.5 text-sm font-medium transition-all duration-150",
                period === p.key
                  ? "bg-[var(--al-accent)] text-[var(--al-text-inverted)] shadow-[var(--al-shadow-sm)]"
                  : "text-[var(--al-text-muted)] hover:bg-[var(--al-bg-hover)] hover:text-[var(--al-text)]",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? <Spinner label="Computing analytics" /> : null}
      {q.isError ? <ErrorState error={q.error} /> : null}
      {q.data ? <OverviewBody snap={q.data} /> : null}
    </div>
  );
}

function OverviewBody({ snap }: { snap: AnalyticsSnapshot }) {
  const u = snap.usage;
  const t = snap.tools;
  const w = snap.workflow;

  const toolSuccessRate = formatProvenanced(t.toolFailureRate, (fr) => formatPct(1 - fr));
  const verifiedRate =
    u.totalSessions.value > 0
      ? formatPct(w.sessionsEndingAfterSuccessfulVerification.value / u.totalSessions.value)
      : "—";

  const recCount = snap.recommendations.length;
  const topBand =
    recCount > 0
      ? confidenceBand(Math.max(...snap.recommendations.map((r) => r.confidence)))
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Stat
          label="Sessions"
          value={formatProvenanced(u.totalSessions, formatNumber)}
          hint={<ProvenanceTag provenance={u.totalSessions.provenance} />}
        />
        <Stat
          label="Active time"
          value={formatProvenanced(u.totalDurationMs, formatDuration)}
          hint={<ProvenanceTag provenance={u.totalDurationMs.provenance} />}
        />
        <Stat
          label="Prompts"
          value={formatProvenanced(u.promptsPerSession, (v) => formatNumber(v))}
          hint="per session"
        />
        <Stat
          label="Tool calls"
          value={formatProvenanced(u.toolCallsPerSession, (v) => formatNumber(v))}
          hint="per session"
        />
        <Stat
          label="Token usage"
          value={formatProvenanced(u.totalTokens, formatTokens)}
          hint={<ProvenanceTag provenance={u.totalTokens.provenance} />}
        />
        <Stat
          label="Estimated cost"
          value={formatProvenanced(u.estimatedCostUsd, formatCost)}
          hint={COST_ESTIMATE_LABEL}
          tone="text-[var(--al-accent)]"
        />
        <Stat
          label="Tool success rate"
          value={toolSuccessRate}
          hint={<ProvenanceTag provenance={t.toolFailureRate.provenance} />}
        />
        <Stat
          label="Verified completion rate"
          value={verifiedRate}
          hint="sessions ending after a green check"
        />
        <Stat
          label="Recommendations"
          value={formatNumber(recCount)}
          hint={topBand ? confidenceLabel(topBand) : "no findings"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ModelUsageChart snap={snap} />
        <CompletionChart snap={snap} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ToolUsageCard snap={snap} />
        <CompletenessCard snap={snap} />
      </div>
    </div>
  );
}

function ModelUsageChart({ snap }: { snap: AnalyticsSnapshot }) {
  const data = snap.usage.modelUsage
    .filter((m) => m.modelRequests > 0)
    .map((m) => ({
      model: m.modelId.replace(/^claude-/, ""),
      requests: m.modelRequests,
      cost: m.estimatedCostUsd ?? 0,
    }));

  return (
    <Card>
      <CardTitle>Requests by model</CardTitle>
      <div className="mt-4 h-64">
        {data.length === 0 ? (
          <EmptyState title="No model usage">No model requests recorded in this period.</EmptyState>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -8 }}>
              <defs>
                <linearGradient id="modelBar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--al-accent)" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="var(--al-accent)" stopOpacity={0.55} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--al-border)" vertical={false} />
              <XAxis
                dataKey="model"
                tick={{ fill: "var(--al-text-muted)", fontSize: 11 }}
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
              <Bar dataKey="requests" fill="url(#modelBar)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="mt-3 text-xs text-[var(--al-text-muted)]">{COST_ESTIMATE_LABEL}</p>
    </Card>
  );
}

function CompletionChart({ snap }: { snap: AnalyticsSnapshot }) {
  const c = snap.completion;
  const total = c.completed + c.interrupted + c.failed + c.unknown;
  const data = [
    { name: "completed", value: c.completed, color: COMPLETION_COLORS.completed },
    { name: "interrupted", value: c.interrupted, color: COMPLETION_COLORS.interrupted },
    { name: "failed", value: c.failed, color: COMPLETION_COLORS.failed },
    { name: "unknown", value: c.unknown, color: COMPLETION_COLORS.unknown },
  ].filter((d) => d.value > 0);

  return (
    <Card>
      <CardTitle>Session completion</CardTitle>
      <div className="mt-4 h-64">
        {data.length === 0 ? (
          <EmptyState title="No sessions">No completed sessions to summarise.</EmptyState>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={56}
                outerRadius={84}
                paddingAngle={3}
                stroke="var(--al-bg-elevated)"
                strokeWidth={2}
              >
                {data.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "var(--al-bg-elevated)",
                  border: "1px solid var(--al-border)",
                  borderRadius: "var(--al-radius-lg)",
                  fontSize: 12,
                  color: "var(--al-text)",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--al-text-secondary)]">
        {data.map((d) => {
          const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
          return (
            <li key={d.name} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: d.color }}
              />
              <span className="font-medium capitalize">{d.name}</span>
              <span className="tabular-nums text-[var(--al-text-muted)]">
                {d.value} ({pct}%)
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ToolUsageCard({ snap }: { snap: AnalyticsSnapshot }) {
  const tools = snap.tools.mostUsedTools.slice(0, 6);
  return (
    <Card>
      <CardTitle>Most-used tools</CardTitle>
      {tools.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No tool calls">No tool usage recorded in this period.</EmptyState>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--al-border)] text-sm">
          {tools.map((tool) => (
            <li key={tool.toolName} className="flex items-center justify-between py-2.5">
              <span className="font-mono text-[var(--al-text)]">{tool.toolName}</span>
              <span className="flex items-center gap-3 tabular-nums text-[var(--al-text-secondary)]">
                <span>{formatNumber(tool.calls)} calls</span>
                <span
                  className={cn(
                    "font-medium",
                    tool.failureRate > 0.3
                      ? "text-[var(--al-danger)]"
                      : "text-[var(--al-text-muted)]",
                  )}
                >
                  {formatPct(tool.failureRate)} fail
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CompletenessCard({ snap }: { snap: AnalyticsSnapshot }) {
  const c = snap.completeness;
  const total = c.totalSessions;
  const flags: Array<[string, number]> = [
    ["complete", c.complete],
    ["tail missing", c.partialTailMissing],
    ["metrics missing", c.partialMetricsMissing],
    ["prompts missing", c.partialPromptsMissing],
  ];
  return (
    <Card>
      <CardTitle>Data completeness</CardTitle>
      {total === 0 ? (
        <div className="mt-4">
          <EmptyState title="No sessions">
            Imported sessions will be assessed for completeness here.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-4 space-y-3 text-sm">
          {flags.map(([label, n]) => {
            const pct = total > 0 ? Math.round((n / total) * 100) : 0;
            const incomplete = label !== "complete" && n > 0;
            return (
              <li key={label} className="flex flex-col gap-1.5">
                <span className="flex justify-between">
                  <span className="capitalize text-[var(--al-text-secondary)]">{label}</span>
                  <span className="tabular-nums font-medium text-[var(--al-text)]">
                    {n} ({pct}%)
                  </span>
                </span>
                <span className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--al-bg-inset)]">
                  <span
                    className={cn(
                      "block h-full rounded-full transition-all",
                      incomplete ? "bg-[var(--al-warning)]" : "bg-[var(--al-accent)]",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </span>
                {incomplete ? (
                  <span className="text-xs text-[var(--al-warning)]">
                    Some metrics may be inferred — treat as estimates.
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
