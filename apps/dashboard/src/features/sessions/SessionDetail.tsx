/**
 * Session detail screen (spec §13.9). Renders the merged timeline returned by
 * the API (prompts, model requests, tool calls, file ops, command runs,
 * verification runs, failures, compactions) plus per-session recommendations.
 *
 * The API already privacy-gates content fields (§13.11 "Privacy-mode
 * restrictions are enforced"); the dashboard only renders what it receives, so
 * it can never display content unavailable under the active mode. All
 * user-controlled text is rendered as React text children — never injected as
 * HTML — so terminal/ANSI escapes and transcript HTML cannot execute (§19.4).
 */
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FilePen,
  FileText,
  Layers,
  MessageSquare,
  Terminal,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useRoute, navigate } from "../../lib/router.js";
import { useSession, useSessionEvents, useSessionRecommendations } from "../../hooks/useApi.js";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  Spinner,
} from "../../components/ui/primitives.js";
import { ConfidenceBadge } from "../../components/ui/widgets.js";
import { formatDateTime, formatDuration, formatRelative, formatTokens } from "../../lib/format.js";
import type { TimelineEvent } from "../../lib/types.js";

export function SessionDetail({ id: idProp }: { id?: string } = {}) {
  const route = useRoute();
  const id = idProp ?? route.params.id;
  const session = useSession(id);
  const events = useSessionEvents(id);
  const recs = useSessionRecommendations(id);

  return (
    <div className="flex flex-col gap-4">
      <Button size="sm" variant="subtle" onClick={() => navigate("sessions")}>
        ← Back to sessions
      </Button>

      <div>
        <h2 className="font-mono text-xl font-semibold">Session {id}</h2>
        {session.data ? (
          <SessionSummary
            session={session.data.session}
            projectName={session.data.project?.displayName ?? null}
          />
        ) : null}
      </div>

      {session.isLoading ? <Spinner label="Loading session" /> : null}
      {session.isError ? <ErrorState error={session.error} /> : null}

      {recs.data && recs.data.length > 0 ? (
        <Card>
          <CardTitle>Recommendations in this session ({recs.data.length})</CardTitle>
          <ul className="mt-3 space-y-3">
            {recs.data.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone="accent">{r.category}</Badge>
                    <span className="font-medium">{r.title}</span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--al-text-muted)]">{r.summary}</p>
                </div>
                <ConfidenceBadge confidence={r.confidence} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="p-0">
        <div className="border-b border-[var(--al-border)] px-4 py-3">
          <CardTitle>Timeline</CardTitle>
        </div>
        <div className="p-2">
          {events.isLoading ? <Spinner label="Loading timeline" /> : null}
          {events.isError ? <ErrorState error={events.error} /> : null}
          {events.data ? (
            events.data.length === 0 ? (
              <EmptyState title="No events">This session has no reconstructable events.</EmptyState>
            ) : (
              <Timeline events={events.data} />
            )
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function SessionSummary({
  session,
  projectName,
}: {
  session: Record<string, unknown>;
  projectName: string | null;
}) {
  const status = String(session.completionStatus ?? "unknown");
  const startedAt = String(session.startedAt ?? "");
  const endedAt = session.endedAt ? String(session.endedAt) : null;
  const durationMs = typeof session.durationMs === "number" ? session.durationMs : null;
  const model = typeof session.modelId === "string" ? session.modelId : undefined;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--al-text-muted)]">
      <Badge tone={status === "completed" ? "low" : status === "failed" ? "high" : "medium"}>
        {status}
      </Badge>
      {projectName ? <span>Project: {projectName}</span> : null}
      {model ? <span className="font-mono">{model}</span> : null}
      <span title={formatDateTime(startedAt)}>started {formatRelative(startedAt)}</span>
      {endedAt ? (
        <span title={formatDateTime(endedAt)}>ended {formatRelative(endedAt)}</span>
      ) : null}
      {durationMs !== null ? <span>· {formatDuration(durationMs)}</span> : null}
    </div>
  );
}

const KIND_META: Record<string, { icon: LucideIcon; label: string; tone: string }> = {
  prompt: { icon: MessageSquare, label: "Prompt", tone: "accent" },
  model_request: { icon: Activity, label: "Model request", tone: "neutral" },
  tool_call: { icon: Terminal, label: "Tool call", tone: "info" },
  file_activity: { icon: FilePen, label: "File activity", tone: "neutral" },
  command_run: { icon: Terminal, label: "Command", tone: "neutral" },
  verification_run: { icon: CheckCircle2, label: "Verification", tone: "low" },
  compaction: { icon: Layers, label: "Compaction", tone: "medium" },
};

function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative space-y-1">
      {events.map((e, i) => {
        const meta = KIND_META[e.kind] ?? { icon: Clock, label: e.kind, tone: "neutral" };
        const Icon = meta.icon;
        return (
          <li
            key={`${e.timestamp}-${i}`}
            className="flex gap-3 rounded-md px-2 py-2 hover:bg-[var(--al-surface-2)]"
          >
            <div className="mt-0.5 shrink-0">
              <Icon size={16} className="text-[var(--al-text-muted)]" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={meta.tone as never}>{meta.label}</Badge>
                <span
                  className="text-xs text-[var(--al-text-muted)]"
                  title={formatDateTime(e.timestamp)}
                >
                  {formatDateTime(e.timestamp)}
                </span>
              </div>
              <EventBody kind={e.kind} data={e.data} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Render a compact, kind-specific summary from the (privacy-gated) event row. */
function EventBody({ kind, data }: { kind: string; data: Record<string, unknown> }) {
  const str = (v: unknown): string =>
    typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
  switch (kind) {
    case "prompt": {
      const content = str(data.redactedContent);
      const chars = typeof data.characterCount === "number" ? data.characterCount : null;
      const tokens =
        typeof data.approximateTokenCount === "number" ? data.approximateTokenCount : null;
      return (
        <div className="mt-1 text-sm">
          {content ? (
            <p className="whitespace-pre-wrap break-words text-[var(--al-text)]">{content}</p>
          ) : (
            <p className="italic text-[var(--al-text-muted)]">
              Content hidden (metadata-only mode)
            </p>
          )}
          <p className="mt-1 text-xs text-[var(--al-text-muted)]">
            {chars !== null ? `${chars} chars` : null}
            {tokens !== null ? ` · ~${tokens} tokens` : null}
          </p>
        </div>
      );
    }
    case "model_request": {
      const model = str(data.modelId);
      const input = typeof data.inputTokens === "number" ? data.inputTokens : null;
      const output = typeof data.outputTokens === "number" ? data.outputTokens : null;
      return (
        <p className="mt-1 text-sm text-[var(--al-text-muted)]">
          {model ? <span className="font-mono">{model}</span> : "model request"}
          {input !== null ? ` · in ${formatTokens(input)}` : null}
          {output !== null ? ` · out ${formatTokens(output)}` : null}
        </p>
      );
    }
    case "tool_call": {
      const name = str(data.toolName);
      const input = str(data.sanitisedInput);
      const ok = data.success !== false;
      const dur = typeof data.durationMs === "number" ? data.durationMs : null;
      return (
        <div className="mt-1 text-sm">
          <p className="flex items-center gap-2">
            <span className="font-mono">{name}</span>
            {ok ? (
              <CheckCircle2 size={13} className="text-green-500" aria-label="success" />
            ) : (
              <XCircle size={13} className="text-red-500" aria-label="failed" />
            )}
            {dur !== null ? (
              <span className="text-xs text-[var(--al-text-muted)]">{formatDuration(dur)}</span>
            ) : null}
          </p>
          {input ? (
            <pre className="mt-1 overflow-auto rounded bg-[var(--al-surface-2)] p-2 text-xs">
              {input}
            </pre>
          ) : null}
          {!ok && data.failureType ? (
            <p className="mt-1 text-xs text-red-500">failure: {str(data.failureType)}</p>
          ) : null}
        </div>
      );
    }
    case "file_activity": {
      const op = str(data.operation);
      const path = str(data.redactedPath);
      const ok = data.success !== false;
      return (
        <p className="mt-1 flex items-center gap-2 text-sm">
          <FileText size={13} className="text-[var(--al-text-muted)]" aria-hidden="true" />
          <span className="font-mono">{op}</span>
          {path ? (
            <span className="break-all font-mono text-xs text-[var(--al-text-muted)]">{path}</span>
          ) : null}
          {ok ? null : <XCircle size={13} className="text-red-500" aria-label="failed" />}
        </p>
      );
    }
    case "command_run": {
      const cmd = str(data.redactedCommand);
      const fam = str(data.family);
      const ok = data.exitSuccess === true;
      return (
        <div className="mt-1 text-sm">
          <p className="flex items-center gap-2">
            {ok ? (
              <CheckCircle2 size={13} className="text-green-500" aria-label="exit success" />
            ) : (
              <XCircle size={13} className="text-red-500" aria-label="exit failure" />
            )}
            <span className="font-mono text-xs uppercase">{fam || "command"}</span>
          </p>
          {cmd ? (
            <pre className="mt-1 overflow-auto rounded bg-[var(--al-surface-2)] p-2 text-xs">
              {cmd}
            </pre>
          ) : (
            <p className="mt-1 italic text-xs text-[var(--al-text-muted)]">
              Command hidden (metadata-only mode)
            </p>
          )}
        </div>
      );
    }
    case "verification_run": {
      const k = str(data.kind);
      const ok = data.success === true;
      const changed = data.codeChangedAfter === true;
      return (
        <p className="mt-1 flex items-center gap-2 text-sm">
          {ok ? (
            <CheckCircle2 size={13} className="text-green-500" aria-label="success" />
          ) : (
            <AlertTriangle size={13} className="text-amber-500" aria-label="not successful" />
          )}
          <span className="font-mono">{k}</span>
          {changed ? <span className="text-xs text-amber-500">code changed after</span> : null}
        </p>
      );
    }
    case "compaction": {
      const trigger = str(data.trigger);
      const ok = data.success !== false;
      const pre =
        typeof data.approximatePreCompactionTokens === "number"
          ? data.approximatePreCompactionTokens
          : null;
      const post =
        typeof data.approximatePostCompactionTokens === "number"
          ? data.approximatePostCompactionTokens
          : null;
      return (
        <p className="mt-1 flex items-center gap-2 text-sm">
          <Layers size={13} className="text-[var(--al-text-muted)]" aria-hidden="true" />
          <span className="font-mono">{trigger || "compaction"}</span>
          {ok ? null : <XCircle size={13} className="text-red-500" aria-label="failed" />}
          {pre !== null && post !== null ? (
            <span className="text-xs text-[var(--al-text-muted)]">
              {formatTokens(pre)} → {formatTokens(post)}
            </span>
          ) : null}
        </p>
      );
    }
    default:
      return null;
  }
}
