/**
 * Live screen (spec §14.10, §14.9) — the live-collector dashboard.
 *
 * Renders collector/hook/telemetry health indicators, the spool backlog, and a
 * rolling feed of hook + OTLP events delivered over the `/api/v1/live/stream`
 * SSE channel. When the collector isn't running (Phase 1 dashboard mode, or the
 * user hasn't run `agentlens observe`), the status endpoint reports
 * `streaming:false` and we show a calm instruction instead of an empty page.
 *
 * All event content is structured data we produce server-side (counts + the
 * redacted hook-event name) — never raw transcript text — and is rendered as
 * React text children, so no user-controlled string reaches the DOM as HTML
 * (§19.4). No command links execute anything.
 */
import { Activity, Radio, Server, TriangleAlert } from "lucide-react";
import { useLive } from "../../hooks/useApi.js";
import { useLiveStream, type LiveFeedItem } from "../../hooks/useLiveStream.js";
import { formatNumber, formatDateTime } from "../../lib/format.js";
import { Card, CardTitle, Spinner, Badge } from "../../components/ui/primitives.js";

export function Live() {
  const live = useLive();
  const streaming = live.data?.streaming === true;
  const stream = useLiveStream(streaming);

  if (live.isLoading && !live.data) {
    return <Spinner label="Loading live status" />;
  }
  if (live.error && !live.data) {
    return (
      <div className="flex flex-col gap-6">
        <Header connected={false} />
        <p role="alert" className="text-sm text-red-500">
          Could not load live status: {(live.error as Error).message}
        </p>
      </div>
    );
  }

  const status = live.data;

  return (
    <div className="flex flex-col gap-6">
      <Header connected={stream.connected} />

      {!streaming ? (
        <Card className="flex items-start gap-3 border-amber-500/40 bg-amber-500/5">
          <TriangleAlert
            className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
            size={18}
            aria-hidden="true"
          />
          <div className="text-sm">
            <p className="font-medium">Live collection is not running.</p>
            <p className="mt-1 text-[var(--al-text-muted)]">
              Start it with{" "}
              <code className="rounded bg-[var(--al-surface-2)] px-1 py-0.5">
                agentlens observe
              </code>{" "}
              to capture hooks and OpenTelemetry here. Read-only analytics still work via{" "}
              <code className="rounded bg-[var(--al-surface-2)] px-1 py-0.5">agentlens scan</code>.
            </p>
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Indicator
          icon={<Server size={16} aria-hidden="true" />}
          label="Collector"
          running={status?.collector.running ?? false}
          detail={status?.collector.port ? `127.0.0.1:${status.collector.port}` : "—"}
        />
        <Indicator
          icon={<Radio size={16} aria-hidden="true" />}
          label="OTLP receiver"
          running={status?.otel.running ?? false}
          detail={status?.otel.port ? `127.0.0.1:${status.otel.port}` : "—"}
        />
        <StatCard label="Hook events" value={formatNumber(status?.hooks.events)} />
        <StatCard label="Spool backlog" value={formatNumber(status?.spool.backlog)} />
      </div>

      {streaming ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardTitle>Stream</CardTitle>
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <Row label="Connection">
                {stream.connected ? (
                  <Badge tone="low">connected</Badge>
                ) : (
                  <Badge tone="medium">disconnected</Badge>
                )}
              </Row>
              <Row label="OTLP events">{formatNumber(status?.otel.events)}</Row>
              <Row label="Last heartbeat">
                {stream.lastHeartbeat ? formatDateTime(stream.lastHeartbeat) : "—"}
              </Row>
              <Row label="Feed events">{formatNumber(stream.feed.length)}</Row>
            </dl>
          </Card>

          <Card className="lg:col-span-2">
            <CardTitle>Live event feed</CardTitle>
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              {stream.feed.length === 0 ? (
                <li className="text-[var(--al-text-muted)]">
                  Waiting for hook or telemetry events…
                </li>
              ) : (
                stream.feed.map((item) => <FeedRow key={item.id} item={item} />)
              )}
            </ul>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function Header({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Activity size={20} aria-hidden="true" />
      <h1 className="text-lg font-semibold tracking-tight">Live</h1>
      <Badge tone={connected ? "low" : "neutral"}>{connected ? "live" : "idle"}</Badge>
    </div>
  );
}

function Indicator({
  icon,
  label,
  running,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  running: boolean;
  detail: string;
}) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--al-text-muted)]">
        {icon}
        {label}
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={running ? "low" : "medium"}>{running ? "running" : "off"}</Badge>
        <span className="font-mono text-xs text-[var(--al-text-muted)]">{detail}</span>
      </div>
    </Card>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--al-text-muted)]">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--al-text-muted)]">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function FeedRow({ item }: { item: LiveFeedItem }) {
  const name =
    item.type === "hook"
      ? String(item.data.hookEventName ?? "hook")
      : item.type === "otel"
        ? `${String(item.data.kind ?? "otel")} · +${item.data.inserted ?? 0}`
        : item.type;
  const inserted = item.type === "hook" ? (item.data.inserted === true ? "new" : "dup") : null;
  return (
    <li className="flex items-center gap-2 rounded border border-[var(--al-border)] bg-[var(--al-surface)] px-2 py-1.5">
      <Badge tone={item.type === "hook" ? "accent" : "info"}>{item.type}</Badge>
      <span className="font-medium">{name}</span>
      {inserted ? <Badge tone="neutral">{inserted}</Badge> : null}
      <span className="ml-auto font-mono text-xs text-[var(--al-text-muted)]">
        {formatDateTime(item.time)}
      </span>
    </li>
  );
}
