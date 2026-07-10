/**
 * Overview screen (spec §13.9). Surfaces the high-level analytics snapshot with
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
  completed: "#22c55e",
  interrupted: "#f59e0b",
  failed: "#ef4444",
  unknown: "#94a3b8",
};

export function Overview() {
  const [period, setPeriod] = useState("week");
  const q = useMetrics({ period });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Overview</h2>
          <p className="text-sm text-[var(--al-text-muted)]">
            Aggregate usage and behaviour across your local sessions.
          </p>
        </div>
        <div className="flex gap-1 rounded-md border border-[var(--al-border)] bg-[var(--al-surface)] p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              aria-pressed={period === p.key}
              className={
                "rounded px-3 py-1 text-sm transition-colors " +
                (period === p.key
                  ? "bg-[var(--al-accent)] text-white"
                  : "text-[var(--al-text-muted)] hover:text-[var(--al-text)]")
              }
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
      <div className="mt-3 h-64">
        {data.length === 0 ? (
          <EmptyState title="No model usage">No model requests recorded in this period.</EmptyState>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--al-border)" />
              <XAxis dataKey="model" tick={{ fontSize: 11 }} stroke="var(--al-text-muted)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--al-text-muted)" allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "var(--al-surface)",
                  border: "1px solid var(--al-border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="requests" fill="var(--al-accent)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="mt-2 text-xs text-[var(--al-text-muted)]">{COST_ESTIMATE_LABEL}</p>
    </Card>
  );
}

function CompletionChart({ snap }: { snap: AnalyticsSnapshot }) {
  const c = snap.completion;
  const data = [
    { name: "completed", value: c.completed, color: COMPLETION_COLORS.completed },
    { name: "interrupted", value: c.interrupted, color: COMPLETION_COLORS.interrupted },
    { name: "failed", value: c.failed, color: COMPLETION_COLORS.failed },
    { name: "unknown", value: c.unknown, color: COMPLETION_COLORS.unknown },
  ].filter((d) => d.value > 0);

  return (
    <Card>
      <CardTitle>Session completion</CardTitle>
      <div className="mt-3 h-64">
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
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
              >
                {data.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "var(--al-surface)",
                  border: "1px solid var(--al-border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--al-text-muted)]">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
            {d.name}: {d.value}
          </li>
        ))}
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
        <div className="mt-3">
          <EmptyState title="No tool calls">No tool usage recorded in this period.</EmptyState>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--al-border)] text-sm">
          {tools.map((tool) => (
            <li key={tool.toolName} className="flex items-center justify-between py-2">
              <span className="font-mono">{tool.toolName}</span>
              <span className="flex items-center gap-3 tabular-nums text-[var(--al-text-muted)]">
                <span>{formatNumber(tool.calls)} calls</span>
                <span className={tool.failureRate > 0.3 ? "text-red-500" : ""}>
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
        <div className="mt-3">
          <EmptyState title="No sessions">
            Imported sessions will be assessed for completeness here.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {flags.map(([label, n]) => {
            const pct = total > 0 ? Math.round((n / total) * 100) : 0;
            const incomplete = label !== "complete" && n > 0;
            return (
              <li key={label} className="flex flex-col gap-1">
                <span className="flex justify-between">
                  <span className="text-[var(--al-text-muted)]">{label}</span>
                  <span className="tabular-nums">
                    {n} ({pct}%)
                  </span>
                </span>
                {incomplete ? (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
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
