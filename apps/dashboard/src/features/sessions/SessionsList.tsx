/**
 * Sessions list screen (spec §13.9). Search + project/date/model/status filters
 * + pagination. Clicking a row navigates to the session-detail timeline.
 */
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { useProjects, useSessions, type SessionFilters } from "../../hooks/useApi.js";
import { navigate, useRoute } from "../../lib/router.js";
import { formatDateTime, formatDuration, formatNumber, formatRelative } from "../../lib/format.js";
import { Card, EmptyState, ErrorState, Spinner } from "../../components/ui/primitives.js";
import { Badge } from "../../components/ui/widgets.js";
import { Field, Pagination, Select, TextInput } from "../../components/ui/widgets.js";

const STATUSES = [
  { value: "", label: "Any status" },
  { value: "completed", label: "Completed" },
  { value: "interrupted", label: "Interrupted" },
  { value: "failed", label: "Failed" },
  { value: "unknown", label: "Unknown" },
];

export function SessionsList() {
  // Honour a `?projectId=` deep link (e.g. from a recommendation's "View related
  // sessions" link) while still letting the user change the filter afterwards.
  const route = useRoute();
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState(route.params.projectId ?? "");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const limit = 25;

  useEffect(() => {
    const rp = route.params.projectId ?? "";
    setProjectId((cur) => (cur === rp ? cur : rp));
  }, [route.params.projectId]);

  const projects = useProjects();
  const filters: SessionFilters = {
    search: search || undefined,
    projectId: projectId || undefined,
    status: status || undefined,
    page,
    limit,
  };
  const q = useSessions(filters);

  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Sessions</h2>
        <p className="text-sm text-[var(--al-text-secondary)]">
          Browse reconstructed Claude Code sessions and drill into a timeline.
        </p>
      </div>

      <Card className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Field label="Search" htmlFor="session-search">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--al-text-muted)]"
              aria-hidden="true"
            />
            <TextInput
              id="session-search"
              type="search"
              placeholder="session id / project"
              value={search}
              onChange={(e) => resetPage(setSearch)(e.target.value)}
              className="pl-8"
            />
            {search ? (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--al-text-muted)] hover:bg-[var(--al-bg-hover)] hover:text-[var(--al-text)]"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </Field>
        <Field label="Project" htmlFor="project-filter">
          <Select
            id="project-filter"
            value={projectId}
            onChange={(e) => resetPage(setProjectId)(e.target.value)}
          >
            <option value="">All projects</option>
            {(projects.data?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="status-filter">
          <Select
            id="status-filter"
            value={status}
            onChange={(e) => resetPage(setStatus)(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end">
          <span className="text-xs text-[var(--al-text-muted)]">
            Filters apply to <code>startedAt</code>. Model & date-range filters are available in the
            session detail.
          </span>
        </div>
      </Card>

      {q.isLoading ? <Spinner label="Loading sessions" /> : null}
      {q.isError ? <ErrorState error={q.error} /> : null}
      {q.data ? (
        <div className="flex flex-col gap-3">
          {q.data.items.length === 0 ? (
            <EmptyState title="No sessions found" icon={<Search size={28} />}>
              Try clearing filters, or run <code>agentlens scan</code> to import sessions.
            </EmptyState>
          ) : (
            <Card className="overflow-hidden p-0 shadow-[var(--al-shadow-md)]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--al-bg-inset)]">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--al-text-muted)]">
                      <th className="px-4 py-3">Started</th>
                      <th className="px-4 py-3">Session</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Duration</th>
                      <th className="px-4 py-3 text-right">Prompts</th>
                      <th className="px-4 py-3 text-right">Tools</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--al-border)]">
                    {q.data.items.map((s) => (
                      <tr
                        key={s.id}
                        onClick={() => navigate("session", { id: s.id })}
                        className="cursor-pointer transition-colors hover:bg-[var(--al-bg-hover)]"
                      >
                        <td
                          className="px-4 py-3 text-[var(--al-text-secondary)]"
                          title={formatDateTime(s.startedAt)}
                        >
                          {formatRelative(s.startedAt)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-[var(--al-text)]">
                          {s.id}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={s.completionStatus} />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--al-text)]">
                          {formatDuration(s.durationMs)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--al-text-secondary)]">
                          {formatNumber(s.promptCount)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--al-text-secondary)]">
                          {formatNumber(s.toolCallCount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          <Pagination
            page={q.data.page}
            hasMore={q.data.hasMore}
            total={q.data.total}
            onChange={setPage}
          />
          <p className="text-xs text-[var(--al-text-muted)]">
            Showing {q.data.items.length} of {formatNumber(q.data.total)}.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "completed"
      ? "low"
      : status === "failed"
        ? "critical"
        : status === "interrupted"
          ? "medium"
          : "neutral";
  return (
    <Badge tone={tone} className="capitalize">
      {status}
    </Badge>
  );
}
