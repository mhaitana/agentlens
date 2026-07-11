/**
 * Projects screen (spec): per-project usage summary + scan status.
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
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Projects</h2>
        <p className="text-sm text-[var(--al-text-secondary)]">
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
              <Card
                key={p.id}
                className="flex flex-col gap-4 transition-shadow hover:shadow-[var(--al-shadow-md)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--al-radius-md)] bg-[var(--al-accent-weak)] text-[var(--al-accent)]">
                      <FolderGit2 size={20} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-[var(--al-text)]">
                        {p.displayName}
                      </h3>
                      <p className="truncate font-mono text-xs text-[var(--al-text-muted)]">
                        {p.redactedPath ?? "path redacted"}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--al-accent-weak)] px-2.5 py-1 text-xs font-medium text-[var(--al-accent)]">
                    {formatNumber(p.sessionCount)} sessions
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-[var(--al-text-muted)]">
                  <span>First seen {formatDateTime(p.firstSeenAt)}</span>
                  <span>Last seen {formatDateTime(p.lastSeenAt)}</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate("sessions", { projectId: p.id })}
                >
                  View sessions →
                </Button>
              </Card>
            ))}
          </div>
        )
      ) : null}

      <Card>
        <CardTitle>Scan status</CardTitle>
        <p className="mt-3 text-sm text-[var(--al-text-secondary)]">
          Scans are triggered from the CLI. Run <code>agentlens scan --path &lt;dir&gt;</code> to
          import or refresh transcripts. Phase 1 scanning is read-only — nothing is uploaded.
        </p>
      </Card>
    </div>
  );
}
