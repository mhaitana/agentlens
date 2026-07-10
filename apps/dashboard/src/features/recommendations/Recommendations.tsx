/**
 * Recommendations screen (spec §13.9): severity, category, confidence,
 * evidence, estimated impact, remediation, and dismiss/restore actions.
 *
 * Evidence is the structured, queryable backing for each finding (§3.3
 * "evidence before advice") — never generic advice. Remediations are proposed
 * only; AgentLens never applies them without explicit approval (§3.5), so the
 * dashboard shows previews read-only.
 */
import { useState } from "react";
import {
  useRecommendations,
  useDismissRecommendation,
  useRestoreRecommendation,
} from "../../hooks/useApi.js";
import { Badge, Card, EmptyState, ErrorState, Spinner } from "../../components/ui/primitives.js";
import { Button, ConfidenceBadge } from "../../components/ui/widgets.js";
import { formatRelative } from "../../lib/format.js";
import type { RecommendationRow } from "../../lib/types.js";

export function Recommendations() {
  const q = useRecommendations();
  const dismiss = useDismissRecommendation();
  const restore = useRestoreRecommendation();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">Recommendations</h2>
        <p className="text-sm text-[var(--al-text-muted)]">
          Evidence-backed findings from the rule engine. Every recommendation links to the behaviour
          that triggered it.
        </p>
      </div>

      {q.isLoading ? <Spinner label="Loading recommendations" /> : null}
      {q.isError ? <ErrorState error={q.error} /> : null}
      {q.data ? (
        q.data.length === 0 ? (
          <EmptyState title="No active recommendations">
            Run a scan to populate metrics, or adjust the minimum confidence threshold in settings.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            {q.data.map((r) => (
              <RecommendationCard
                key={r.id}
                rec={r}
                onDismiss={() => dismiss.mutate(r.id)}
                onRestore={() => restore.mutate(r.id)}
                busy={dismiss.isPending || restore.isPending}
              />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

function RecommendationCard({
  rec,
  onDismiss,
  onRestore,
  busy,
}: {
  rec: RecommendationRow;
  onDismiss: () => void;
  onRestore: () => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const evidence = Array.isArray(rec.evidence) ? (rec.evidence as EvidenceItem[]) : [];
  const impact = rec.estimatedImpact as ImpactShape | null;
  const remediation = rec.remediation as RemediationShape | null;
  const dismissed = rec.status === "dismissed";

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={severityTone(rec.severity)}>{rec.severity}</Badge>
            <Badge tone="accent">{rec.category}</Badge>
            <span className="font-mono text-xs text-[var(--al-text-muted)]">{rec.ruleId}</span>
            {dismissed ? <Badge tone="neutral">dismissed</Badge> : null}
          </div>
          <h3 className="mt-2 font-semibold">{rec.title}</h3>
          <p className="mt-1 text-sm text-[var(--al-text-muted)]">{rec.summary}</p>
        </div>
        <ConfidenceBadge confidence={rec.confidence} />
      </div>

      <p className="mt-3 text-sm">{rec.explanation}</p>

      {evidence.length > 0 ? (
        <div className="mt-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium text-[var(--al-accent)] hover:underline"
            aria-expanded={expanded}
          >
            {expanded ? "Hide evidence" : `Show evidence (${evidence.length})`}
          </button>
          {expanded ? (
            <ul className="mt-2 space-y-2 border-l-2 border-[var(--al-border)] pl-3">
              {evidence.map((ev, i) => (
                <li key={i} className="text-sm">
                  <p>{ev.description}</p>
                  {ev.kind ? (
                    <p className="font-mono text-xs text-[var(--al-text-muted)]">kind: {ev.kind}</p>
                  ) : null}
                  {Array.isArray(ev.metrics) && ev.metrics.length > 0 ? (
                    <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[var(--al-text-muted)]">
                      {ev.metrics.map((m, j) => (
                        <li key={j}>
                          {m.label}: <span className="tabular-nums">{String(m.value)}</span>{" "}
                          <span className="opacity-60">({m.provenance})</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {impact || remediation ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {impact ? (
            <div>
              <h4 className="text-xs font-semibold uppercase text-[var(--al-text-muted)]">
                Estimated impact
              </h4>
              <ImpactSummary impact={impact} />
              <p className="mt-1 text-xs text-[var(--al-text-muted)]">
                Methodology: {impact.methodology}
              </p>
            </div>
          ) : null}
          {remediation ? (
            <div>
              <h4 className="text-xs font-semibold uppercase text-[var(--al-text-muted)]">
                Proposed remediation
              </h4>
              <Badge tone="neutral">{remediation.type}</Badge>
              <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-[var(--al-surface-2)] p-2 text-xs">
                {remediation.preview}
              </pre>
              {remediation.targetPath ? (
                <p className="mt-1 break-all font-mono text-xs text-[var(--al-text-muted)]">
                  {remediation.targetPath}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-[var(--al-text-muted)]">
                {remediation.automaticallyApplicable
                  ? "Could be auto-applied — but still requires your approval."
                  : "Requires manual action. Never applied automatically."}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-[var(--al-text-muted)]">
          Updated {formatRelative(rec.updatedAt)}
        </span>
        <div className="flex gap-2">
          {dismissed ? (
            <Button size="sm" variant="ghost" onClick={onRestore} disabled={busy}>
              Restore
            </Button>
          ) : (
            <Button size="sm" variant="subtle" onClick={onDismiss} disabled={busy}>
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function ImpactSummary({ impact }: { impact: ImpactShape }) {
  const rows: Array<[string, string]> = [];
  if (impact.tokenRange)
    rows.push(["Tokens", `${impact.tokenRange.minimum}–${impact.tokenRange.maximum}`]);
  if (impact.costUsdRange)
    rows.push(["Cost (est.)", `$${impact.costUsdRange.minimum}–$${impact.costUsdRange.maximum}`]);
  if (impact.durationMsRange)
    rows.push([
      "Duration",
      `${impact.durationMsRange.minimum}–${impact.durationMsRange.maximum}ms`,
    ]);
  if (rows.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-sm">
      {rows.map(([label, val]) => (
        <li key={label} className="flex justify-between">
          <span className="text-[var(--al-text-muted)]">{label}</span>
          <span className="tabular-nums">{val}</span>
        </li>
      ))}
    </ul>
  );
}

interface EvidenceItem {
  description: string;
  kind?: string;
  references?: string[];
  metrics?: Array<{ label: string; value: string | number; provenance: string }>;
}
interface ImpactShape {
  tokenRange?: { minimum: number; maximum: number };
  costUsdRange?: { minimum: number; maximum: number };
  durationMsRange?: { minimum: number; maximum: number };
  confidence: number;
  methodology: string;
}
interface RemediationShape {
  type: string;
  preview: string;
  targetPath?: string;
  automaticallyApplicable: boolean;
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
