/**
 * Sessions list screen (spec §13.9). Search + project/date/model/status filters
 * + pagination. Clicking a row navigates to the session-detail timeline.
 */
import { useState } from "react";
import { useProjects, useSessions, type SessionFilters } from "../../hooks/useApi.js";
import { navigate } from "../../lib/router.js";
import { formatDateTime, formatDuration, formatNumber, formatRelative } from "../../lib/format.js";
import { Card, EmptyState, ErrorState, Spinner } from "../../components/ui/primitives.js";
import { Field, Pagination, Select, TextInput } from "../../components/ui/widgets.js";

const STATUSES = [
  { value: "", label: "Any status" },
  { value: "completed", label: "Completed" },
  { value: "interrupted", label: "Interrupted" },
  { value: "failed", label: "Failed" },
  { value: "unknown", label: "Unknown" },
];

export function SessionsList() {
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const limit = 25;

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
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">Sessions</h2>
        <p className="text-sm text-[var(--al-text-muted)]">
          Browse reconstructed Claude Code sessions and drill into a timeline.
        </p>
      </div>

      <Card className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Search" htmlFor="session-search">
          <TextInput
            id="session-search"
            type="search"
            placeholder="session id / project"
            value={search}
            onChange={(e) => resetPage(setSearch)(e.target.value)}
          />
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
            <EmptyState title="No sessions found">
              Try clearing filters, or run <code>agentlens scan</code> to import sessions.
            </EmptyState>
          ) : (
            <Card className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--al-border)] text-left text-xs text-[var(--al-text-muted)]">
                    <th className="px-3 py-2 font-medium">Started</th>
                    <th className="px-3 py-2 font-medium">Session</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Duration</th>
                    <th className="px-3 py-2 text-right font-medium">Prompts</th>
                    <th className="px-3 py-2 text-right font-medium">Tools</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => navigate("session", { id: s.id })}
                      className="cursor-pointer border-b border-[var(--al-border)] last:border-0 hover:bg-[var(--al-surface-2)]"
                    >
                      <td
                        className="px-3 py-2 text-[var(--al-text-muted)]"
                        title={formatDateTime(s.startedAt)}
                      >
                        {formatRelative(s.startedAt)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{s.id}</td>
                      <td className="px-3 py-2">
                        <span className="text-[var(--al-text-muted)]">{s.completionStatus}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatDuration(s.durationMs)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(s.promptCount)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(s.toolCallCount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
