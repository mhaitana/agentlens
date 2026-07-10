/**
 * Projects screen (spec §13.9): per-project usage summary + scan status.
 * Shows session counts, redacted paths (never raw), and links to filtered
 * sessions. Raw paths are never displayed — only the stored redacted label.
 */
import { FolderGit2 } from "lucide-react";
import { useProjects } from "../../hooks/useApi.js";
import { navigate } from "../../lib/router.js";
import { formatDateTime, formatNumber } from "../../lib/format.js";
import {
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  Spinner,
} from "../../components/ui/primitives.js";
import { Button } from "../../components/ui/widgets.js";

export function Projects() {
  const q = useProjects();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">Projects</h2>
        <p className="text-sm text-[var(--al-text-muted)]">
          Discovered projects from imported Claude Code transcripts.
        </p>
      </div>

      {q.isLoading ? <Spinner label="Loading projects" /> : null}
      {q.isError ? <ErrorState error={q.error} /> : null}
      {q.data ? (
        q.data.items.length === 0 ? (
          <EmptyState title="No projects found" icon={<FolderGit2 size={28} />}>
            Run <code>agentlens scan</code> to discover projects from your Claude Code transcripts.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {q.data.items.map((p) => (
              <Card key={p.id} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{p.displayName}</h3>
                    <p className="truncate font-mono text-xs text-[var(--al-text-muted)]">
                      {p.redactedPath ?? "path redacted"}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--al-accent-weak)] px-2 py-0.5 text-xs font-medium text-[var(--al-accent)]">
                    {formatNumber(p.sessionCount)} sessions
                  </span>
                </div>
                <div className="text-xs text-[var(--al-text-muted)]">
                  <span>First seen {formatDateTime(p.firstSeenAt)}</span>
                  <br />
                  <span>Last seen {formatDateTime(p.lastSeenAt)}</span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => navigate("sessions", {})}>
                  View sessions →
                </Button>
              </Card>
            ))}
          </div>
        )
      ) : null}

      <Card>
        <CardTitle>Scan status</CardTitle>
        <p className="mt-2 text-sm text-[var(--al-text-muted)]">
          Scans are triggered from the CLI. Run <code>agentlens scan --path &lt;dir&gt;</code> to
          import or refresh transcripts. Phase 1 scanning is read-only — nothing is uploaded.
        </p>
      </Card>
    </div>
  );
}
