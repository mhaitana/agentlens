/**
 * Getting started / onboarding screen (spec §13.9 onboarding).
 *
 * Explains what AgentLens reads, where data remains, the active privacy mode,
 * discovered Claude Code sources, project exclusions, and the first-scan
 * preview. Mode selection + exclusion editing live on the Privacy screen
 * (M2-7); this view surfaces the current state read-only with a link.
 */
import { Database, FolderLock, ScanLine, ShieldCheck, ArrowRight } from "lucide-react";
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
        <h2 className="text-xl font-semibold tracking-tight">Getting started with AgentLens</h2>
        <p className="text-sm text-[var(--al-text-secondary)]">
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

  const cards = [
    {
      icon: ScanLine,
      title: "What AgentLens reads",
      items: data.whatAgentLensReads,
      footer: "No real transcript is ever uploaded. Scanning is an explicit, read-only action.",
    },
    {
      icon: FolderLock,
      title: "Where your data remains",
      mono: data.whereDataRemains,
      footer:
        "All sessions, metrics, and recommendations live in this local directory. No account, no cloud.",
    },
    {
      icon: ShieldCheck,
      title: "Privacy mode",
      badge: data.privacyMode,
      footer: modeDescription(data.privacyMode),
    },
    {
      icon: Database,
      title: "Discovered data",
      stats: [
        {
          label: "Sources",
          value: data.sources.map((s) => s.displayName).join(", ") || "none yet",
        },
        { label: "Projects", value: data.projectsCount },
        { label: "Sessions imported", value: data.sessionsCount },
        { label: "Excluded projects", value: data.exclusions.length },
      ],
      exclusions: data.exclusions,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <Card key={idx} className={card.stats ? "lg:col-span-2" : ""}>
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-[var(--al-radius-md)] bg-[var(--al-accent-weak)] text-[var(--al-accent)]">
                <Icon size={16} aria-hidden="true" />
              </div>
              <CardTitle className="mb-0">{card.title}</CardTitle>
            </div>

            {card.items ? (
              <ul className="space-y-2 text-sm text-[var(--al-text)]">
                {card.items.map((line, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-[var(--al-accent)]">•</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {card.mono ? (
              <p className="break-all font-mono text-xs text-[var(--al-text-muted)]">{card.mono}</p>
            ) : null}

            {card.badge ? (
              <div className="flex items-center gap-2">
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
            ) : null}

            {card.stats ? (
              <div className="grid grid-cols-2 gap-3 text-sm">
                {card.stats.map((s) => (
                  <div key={s.label}>
                    <dt className="text-[var(--al-text-muted)]">{s.label}</dt>
                    <dd className="font-medium text-[var(--al-text)]">{s.value}</dd>
                  </div>
                ))}
              </div>
            ) : null}

            {card.exclusions && card.exclusions.length > 0 ? (
              <ul className="mt-3 space-y-1 font-mono text-xs text-[var(--al-text-muted)]">
                {card.exclusions.map((e) => (
                  <li key={e} className="truncate">
                    {e}
                  </li>
                ))}
              </ul>
            ) : null}

            {card.footer ? (
              <p className="mt-3 text-xs text-[var(--al-text-muted)]">{card.footer}</p>
            ) : null}
          </Card>
        );
      })}

      {!data.hasData ? (
        <Card className="lg:col-span-2">
          <EmptyState title="No data yet — run your first scan">
            Open a terminal in your project and run{" "}
            <code className="rounded bg-[var(--al-bg-inset)] px-1.5 py-0.5 text-[var(--al-text)]">
              agentlens scan
            </code>
            , then return here. You can also import a directory with{" "}
            <code className="rounded bg-[var(--al-bg-inset)] px-1.5 py-0.5 text-[var(--al-text)]">
              agentlens scan --path &lt;dir&gt;
            </code>
            .
          </EmptyState>
        </Card>
      ) : (
        <Card className="lg:col-span-2">
          <CardTitle>First-scan preview</CardTitle>
          <p className="mt-3 text-sm text-[var(--al-text-secondary)]">
            {data.sessionsCount} session(s) imported across {data.projectsCount} project(s). Head to
            the Overview for metrics or Sessions for a timeline.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => navigate("overview")}>
              Go to overview
              <ArrowRight size={14} />
            </Button>
            <Button variant="secondary" onClick={() => navigate("sessions")}>
              Browse sessions
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function modeDescription(mode: string): string {
  switch (mode) {
    case "metadata-only":
      return "Only counts and metrics are stored; no prompt content or paths.";
    case "redacted-content":
      return "Redacted content is stored; secrets and raw paths are scrubbed before persist.";
    case "full-local":
      return "Full local content retained (secrets still scrubbed). Chosen with an explicit opt-in.";
    default:
      return "";
  }
}
