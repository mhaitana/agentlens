/**
 * Privacy & settings screen (spec"Privacy and settings",).
 *
 * Interactive privacy controls (M2-7): the user can change the active privacy
 * mode — full-local requires an explicit opt-in after a strong warning
 * — adjust the retention window, add/remove excluded project paths, and toggle
 * email/home-path redaction. All edits go through `POST /api/v1/settings`
 * (`useUpdateSetting`), which is token-gated and re-validates + persists the
 * versioned config. Secrets/auth headers/known API-key formats are never
 * persisted in any mode — the dashboard always says so.
 *
 * Destructive actions (purge / export) require the runtime token (sent by the
 * API client) and a confirmation dialog. All user-controlled text is rendered
 * as React children.
 */
import { useState } from "react";
import { Download, Plus, Trash2, X, Shield, Eye, Database, Lock } from "lucide-react";
import { usePrivacy, usePurgeData, useExportData, useUpdateSetting } from "../../hooks/useApi.js";
import { cn } from "../../lib/cn.js";
import type { PrivacyMode } from "../../lib/types.js";
import { Badge, Card, CardTitle, ErrorState, Spinner } from "../../components/ui/primitives.js";
import { Button, ConfirmDialog, Field, TextInput } from "../../components/ui/widgets.js";
import { formatDate } from "../../lib/format.js";

const MODES: PrivacyMode[] = ["metadata-only", "redacted-content", "full-local"];

const MODE_META: Record<
  PrivacyMode,
  { label: string; icon: typeof Shield; tone: "info" | "low" | "high"; description: string }
> = {
  "metadata-only": {
    label: "Metadata only",
    icon: Lock,
    tone: "info",
    description:
      "Only counts and metrics are stored. No prompt content, tool inputs, file paths, or commands.",
  },
  "redacted-content": {
    label: "Redacted content",
    icon: Shield,
    tone: "low",
    description:
      "Redacted content is stored; secrets and raw paths are scrubbed before persistence. Recommended.",
  },
  "full-local": {
    label: "Full local",
    icon: Eye,
    tone: "high",
    description:
      "Full local content retained, but secrets/auth headers/known API-key formats are still never persisted. Explicit opt-in.",
  },
};

export function Privacy() {
  const q = usePrivacy();
  const purge = usePurgeData();
  const exportData = useExportData();
  const update = useUpdateSetting();
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [confirmFullLocal, setConfirmFullLocal] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  const setSetting = (key: string, value: unknown) => update.mutate({ key, value });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Privacy & settings</h2>
        <p className="text-sm text-[var(--al-text-secondary)]">
          Your data stays local. Adjust what is stored and how long it is kept.
        </p>
      </div>

      {q.isLoading ? <Spinner label="Loading privacy settings" /> : null}
      {q.isError ? <ErrorState error={q.error} /> : null}
      {update.isError ? <ErrorState error={update.error} /> : null}
      {q.data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PrivacyModeCard
            mode={q.data.mode}
            pending={update.isPending}
            onChange={(m) =>
              m === "full-local" ? setConfirmFullLocal(true) : setSetting("privacy.mode", m)
            }
          />

          <RetentionCard
            days={q.data.retentionDays}
            pending={update.isPending}
            onSave={(days) => setSetting("privacy.retentionDays", days)}
          />

          <RedactionCard
            redactEmails={q.data.redactEmails}
            redactHomePath={q.data.redactHomePath}
            customPatterns={q.data.customPatterns.length}
            pending={update.isPending}
            onToggle={(key, val) => setSetting(key, val)}
          />

          <ExclusionsCard
            excluded={q.data.excludedProjects}
            pending={update.isPending}
            onSave={(list) => setSetting("sources.claudeCode.excludedProjects", list)}
          />

          <Card className="lg:col-span-2">
            <CardTitle>Stored data categories</CardTitle>
            <p className="mt-3 text-sm text-[var(--al-text-secondary)]">
              {q.data.storedDataCategories.join(", ")}
            </p>
            <p className="mt-3 break-all font-mono text-xs text-[var(--al-text-muted)]">
              Data location: {q.data.dataLocation}
            </p>
          </Card>

          <Card className="lg:col-span-2">
            <CardTitle>Data management</CardTitle>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={exportData.isPending}
                onClick={() => {
                  exportData.mutate(undefined, {
                    onSuccess: (res) => {
                      const blob = new Blob([JSON.stringify(res, null, 2)], {
                        type: "application/json",
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `agentlens-export-${formatDate(new Date().toISOString())}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      setExported("Export downloaded.");
                    },
                  });
                }}
              >
                <Download size={14} /> Export all data (JSON)
              </Button>
              <Button variant="danger" onClick={() => setConfirmPurge(true)}>
                <Trash2 size={14} /> Purge all data
              </Button>
            </div>
            {exportData.isError ? <ErrorState error={exportData.error} /> : null}
            {exported ? <p className="mt-2 text-xs text-[var(--al-success)]">{exported}</p> : null}
          </Card>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmPurge}
        title="Purge all stored data?"
        confirmLabel="Purge everything"
        busy={purge.isPending}
        onConfirm={() =>
          purge.mutate(undefined, {
            onSuccess: () => setConfirmPurge(false),
          })
        }
        onCancel={() => setConfirmPurge(false)}
      >
        This permanently deletes every imported session, prompt, tool call, file activity, command
        run, verification run, compaction, and recommendation from your local database. Your config
        is preserved. This cannot be undone.
      </ConfirmDialog>

      {/* Full-local explicit opt-in: strong warning before applying. */}
      <ConfirmDialog
        open={confirmFullLocal}
        title="Enable full-local mode?"
        confirmLabel="I understand — enable full-local"
        busy={update.isPending}
        onConfirm={() => {
          setSetting("privacy.mode", "full-local");
          setConfirmFullLocal(false);
        }}
        onCancel={() => setConfirmFullLocal(false)}
      >
        Full-local retains the most local content. Even in this mode, AgentLens still runs secret
        detection and never persists environment-variable secrets, authentication headers, or known
        API-key formats. Only enable this if you accept more content being stored locally on this
        machine.
      </ConfirmDialog>
    </div>
  );
}

function PrivacyModeCard({
  mode,
  pending,
  onChange,
}: {
  mode: PrivacyMode;
  pending: boolean;
  onChange: (m: PrivacyMode) => void;
}) {
  const meta = MODE_META[mode];
  return (
    <Card className="lg:col-span-2">
      <CardTitle>Active privacy mode</CardTitle>
      <div className="mt-4 flex items-center gap-2">
        <Badge tone={meta.tone}>{mode}</Badge>
        {mode === "redacted-content" ? (
          <span className="text-xs text-[var(--al-text-muted)]">recommended</span>
        ) : null}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {MODES.map((m) => {
          const item = MODE_META[m];
          const ItemIcon = item.icon;
          return (
            <button
              key={m}
              aria-label={`Select ${item.label} mode`}
              onClick={() => onChange(m)}
              disabled={pending}
              className={cn(
                "flex flex-col items-start gap-2 rounded-[var(--al-radius-lg)] border p-4 text-left transition-all duration-150",
                mode === m
                  ? "border-[var(--al-accent)] bg-[var(--al-accent-ghost)]"
                  : "border-[var(--al-border)] bg-[var(--al-bg-elevated)] hover:border-[var(--al-border-strong)] hover:bg-[var(--al-bg-hover)]",
              )}
            >
              <ItemIcon
                size={18}
                className={mode === m ? "text-[var(--al-accent)]" : "text-[var(--al-text-muted)]"}
              />
              <span className="text-sm font-semibold text-[var(--al-text)]">{item.label}</span>
              <span className="text-xs text-[var(--al-text-secondary)]">{item.description}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function RetentionCard({
  days,
  pending,
  onSave,
}: {
  days: number | null;
  pending: boolean;
  onSave: (days: number) => void;
}) {
  const [draft, setDraft] = useState<string>(days ? String(days) : "");
  const [saved, setSaved] = useState<string | null>(null);
  const submit = () => {
    const n = Number.parseInt(draft, 10);
    if (!Number.isFinite(n) || n < 0) return;
    onSave(n);
    setSaved(`Saved: data older than ${n} day(s) is pruned on scan.`);
  };
  return (
    <Card>
      <CardTitle>Retention</CardTitle>
      <p className="mt-3 text-sm text-[var(--al-text)]">
        {days ? `Auto-delete data older than ${days} days.` : "No automatic retention limit set."}
      </p>
      <p className="mt-2 text-xs text-[var(--al-text-muted)]">
        Retention is enforced when you run a scan; pruned sessions and their events are removed.
      </p>
      <div className="mt-4 flex items-end gap-2">
        <Field label="Retention window (days)" htmlFor="retention-days">
          <TextInput
            id="retention-days"
            type="number"
            min={0}
            value={draft}
            placeholder="e.g. 90"
            disabled={pending}
            onChange={(e) => setDraft(e.target.value)}
          />
        </Field>
        <Button size="sm" variant="primary" disabled={pending} onClick={submit}>
          Save
        </Button>
      </div>
      {saved ? <p className="mt-3 text-xs text-[var(--al-success)]">{saved}</p> : null}
    </Card>
  );
}

function RedactionCard({
  redactEmails,
  redactHomePath,
  customPatterns,
  pending,
  onToggle,
}: {
  redactEmails: boolean;
  redactHomePath: boolean;
  customPatterns: number;
  pending: boolean;
  onToggle: (key: string, value: boolean) => void;
}) {
  return (
    <Card>
      <CardTitle>Redaction</CardTitle>
      <ul className="mt-4 space-y-3 text-sm">
        <li className="flex items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={redactEmails}
              disabled={pending}
              onChange={(e) => onToggle("privacy.redactEmails", e.target.checked)}
              className="h-4 w-4 accent-[var(--al-accent)]"
            />
            <span className="text-[var(--al-text)]">Email redaction</span>
          </label>
        </li>
        <li className="flex items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={redactHomePath}
              disabled={pending}
              onChange={(e) => onToggle("privacy.redactHomePath", e.target.checked)}
              className="h-4 w-4 accent-[var(--al-accent)]"
            />
            <span className="text-[var(--al-text)]">Home-path redaction</span>
          </label>
        </li>
      </ul>
      <p className="mt-4 text-xs text-[var(--al-text-muted)]">
        <Database size={12} className="inline" /> Custom patterns: {customPatterns}. Secrets, auth
        headers, and known API-key formats are always scrubbed — even in full-local mode.
      </p>
    </Card>
  );
}

function ExclusionsCard({
  excluded,
  pending,
  onSave,
}: {
  excluded: string[];
  pending: boolean;
  onSave: (list: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || excluded.includes(v)) return;
    onSave([...excluded, v]);
    setDraft("");
  };
  const remove = (entry: string) => onSave(excluded.filter((e) => e !== entry));
  return (
    <Card>
      <CardTitle>Excluded projects</CardTitle>
      <p className="mt-2 text-xs text-[var(--al-text-muted)]">
        Project paths here are skipped during scans.
      </p>
      {excluded.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--al-text-muted)]">No exclusions configured.</p>
      ) : (
        <ul className="mt-4 space-y-1">
          {excluded.map((e) => (
            <li key={e} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 break-all font-mono text-xs text-[var(--al-text-muted)]">
                {e}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => remove(e)}
                aria-label={`Remove exclusion ${e}`}
              >
                <X size={12} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex items-end gap-2">
        <Field label="Add an excluded project path" htmlFor="excluded-path">
          <TextInput
            id="excluded-path"
            value={draft}
            placeholder="/Users/you/secret-project"
            disabled={pending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
        </Field>
        <Button size="sm" variant="primary" disabled={pending} onClick={add}>
          <Plus size={12} /> Add
        </Button>
      </div>
    </Card>
  );
}
