/**
 * Getting started / onboarding screen (spec §13.9 onboarding).
 *
 * Explains what AgentLens reads, where data remains, the active privacy mode,
 * discovered Claude Code sources, project exclusions, and the first-scan
 * preview. Mode selection + exclusion editing live on the Privacy screen
 * (M2-7); this view surfaces the current state read-only with a link.
 */
import { Database, FolderLock, ScanLine, ShieldCheck } from "lucide-react";
import { useOnboarding } from "../../hooks/useApi.js";
import { navigate } from "../../lib/router.js";
import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  Spinner,
} from "../../components/ui/primitives.js";
import { Button } from "../../components/ui/widgets.js";

export function Onboarding() {
  const q = useOnboarding();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold">Getting started with AgentLens</h2>
        <p className="text-sm text-[var(--al-text-muted)]">
          Local-first, privacy-first analytics for Claude Code. Everything stays on this machine.
        </p>
      </div>

      {q.isLoading ? <Spinner label="Loading onboarding" /> : null}
      {q.isError ? <ErrorState error={q.error} /> : null}
      {q.data ? <OnboardingBody /> : null}
    </div>
  );
}

function OnboardingBody() {
  const { data } = useOnboarding();
  if (!data) return null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <div className="flex items-center gap-2">
          <ScanLine size={16} className="text-[var(--al-accent)]" />
          <CardTitle>What AgentLens reads</CardTitle>
        </div>
        <ul className="mt-3 space-y-2 text-sm">
          {data.whatAgentLensReads.map((line, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-[var(--al-accent)]">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-[var(--al-text-muted)]">
          No real transcript is ever uploaded. Scanning is an explicit, read-only action.
        </p>
      </Card>

      <Card>
        <div className="flex items-center gap-2">
          <FolderLock size={16} className="text-[var(--al-accent)]" />
          <CardTitle>Where your data remains</CardTitle>
        </div>
        <p className="mt-3 break-all font-mono text-xs text-[var(--al-text-muted)]">
          {data.whereDataRemains}
        </p>
        <p className="mt-2 text-xs text-[var(--al-text-muted)]">
          All sessions, metrics, and recommendations live in this local directory. No account, no
          cloud.
        </p>
      </Card>

      <Card>
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-[var(--al-accent)]" />
          <CardTitle>Privacy mode</CardTitle>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Badge
            tone={
              data.privacyMode === "metadata-only"
                ? "info"
                : data.privacyMode === "full-local"
                  ? "high"
                  : "low"
            }
          >
            {data.privacyMode}
          </Badge>
          <Button size="sm" variant="ghost" onClick={() => navigate("privacy")}>
            Change →
          </Button>
        </div>
        <p className="mt-2 text-xs text-[var(--al-text-muted)]">
          {data.privacyMode === "metadata-only" &&
            "Only counts and metrics are stored; no prompt content or paths."}
          {data.privacyMode === "redacted-content" &&
            "Redacted content is stored; secrets and raw paths are scrubbed before persist."}
          {data.privacyMode === "full-local" &&
            "Full local content retained (secrets still scrubbed). Chosen with an explicit opt-in."}
        </p>
      </Card>

      <Card>
        <div className="flex items-center gap-2">
          <Database size={16} className="text-[var(--al-accent)]" />
          <CardTitle>Discovered data</CardTitle>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-[var(--al-text-muted)]">Sources</dt>
            <dd className="font-medium">
              {data.sources.map((s) => s.displayName).join(", ") || "none yet"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--al-text-muted)]">Projects</dt>
            <dd className="font-medium">{data.projectsCount}</dd>
          </div>
          <div>
            <dt className="text-[var(--al-text-muted)]">Sessions imported</dt>
            <dd className="font-medium">{data.sessionsCount}</dd>
          </div>
          <div>
            <dt className="text-[var(--al-text-muted)]">Excluded projects</dt>
            <dd className="font-medium">{data.exclusions.length}</dd>
          </div>
        </dl>
        {data.exclusions.length > 0 ? (
          <ul className="mt-2 space-y-1 font-mono text-xs text-[var(--al-text-muted)]">
            {data.exclusions.map((e) => (
              <li key={e} className="truncate">
                {e}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {!data.hasData ? (
        <Card className="lg:col-span-2">
          <EmptyState title="No data yet — run your first scan">
            Open a terminal in your project and run{" "}
            <code className="rounded bg-[var(--al-surface-2)] px-1.5 py-0.5">agentlens scan</code>,
            then return here. You can also import a directory with{" "}
            <code className="rounded bg-[var(--al-surface-2)] px-1.5 py-0.5">
              agentlens scan --path &lt;dir&gt;
            </code>
            .
          </EmptyState>
        </Card>
      ) : (
        <Card className="lg:col-span-2">
          <CardTitle>First-scan preview</CardTitle>
          <p className="mt-2 text-sm text-[var(--al-text-muted)]">
            {data.sessionsCount} session(s) imported across {data.projectsCount} project(s). Head to
            the Overview for metrics or Sessions for a timeline.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" onClick={() => navigate("overview")}>
              Go to overview
            </Button>
            <Button variant="ghost" onClick={() => navigate("sessions")}>
              Browse sessions
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
