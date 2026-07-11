/**
 * Configuration Doctor screen (spec §15.12): overall health, findings by scope,
 * proposed patches with diff preview, validation status, and apply / rollback.
 *
 * Safety (§3.5, §15.9): every patch is `automaticallyApplicable: false`. The
 * dashboard shows the diff + impact + target file (steps 1–3); the user must
 * click Apply and confirm (step 5). Apply backs up, writes, and validates
 * (steps 4, 6, 7) on the server; rollback restores from the backup. Nothing is
 * ever applied without explicit confirmation, and refused patches are shown but
 * never applied.
 *
 * All user-controlled text (diffs, paths, findings) is rendered as React text
 * nodes — never `dangerouslySetInnerHTML` (§19: no terminal-escape execution,
 * no transcript HTML).
 */
import { useMemo, useState } from "react";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { useDoctor, useApplyDoctorPatch, useRollbackDoctorPatch } from "../../hooks/useApi.js";
import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  ProvenanceTag,
  Spinner,
  Stat,
} from "../../components/ui/primitives.js";
import { Button, ConfirmDialog } from "../../components/ui/widgets.js";
import { formatNumber } from "../../lib/format.js";
import type { DoctorPatch, DoctorResponse } from "../../lib/types.js";

export function Doctor() {
  const q = useDoctor();
  const apply = useApplyDoctorPatch();
  const rollback = useRollbackDoctorPatch();
  const [pendingApply, setPendingApply] = useState<DoctorPatch[] | null>(null);
  // rollbackPatch restores by patchId + targetFile (apply.ts); carry both so the
  // restore actually writes — a patchId alone would find the backup but restore
  // nothing (targetFile undefined → restored reported without writing).
  const [pendingRollback, setPendingRollback] = useState<{
    patchId: string;
    targetFile?: string;
  } | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Configuration Doctor</h2>
          <p className="text-sm text-[var(--al-text-secondary)]">
            Read-only checks of your Claude Code configuration, with safe proposed patches. Nothing
            is changed without your explicit approval.
          </p>
        </div>
        {q.data ? <HealthScore score={q.data.report.summary} /> : null}
      </div>

      {q.isLoading ? <Spinner label="Inspecting configuration" /> : null}
      {q.isError ? <ErrorState error={q.error} /> : null}
      {q.data ? (
        <DoctorBody
          data={q.data}
          appliedPatchIds={new Set(q.data.appliedPatchIds)}
          onApply={(patches) => setPendingApply(patches)}
          onRollback={(patch) => setPendingRollback(patch)}
          applyBusy={apply.isPending}
          rollbackBusy={rollback.isPending}
        />
      ) : null}

      <ConfirmDialog
        open={pendingApply !== null}
        title="Apply proposed patches?"
        confirmLabel="Apply (back up first)"
        busy={apply.isPending}
        onConfirm={() => {
          const patches = pendingApply ?? [];
          setPendingApply(null);
          apply.mutate({ approved: true, patchIds: patches.map((p) => p.id) });
        }}
        onCancel={() => setPendingApply(null)}
      >
        <p>
          {pendingApply ? pendingApply.length : 0} patch(es) will be applied. Each target file is
          backed up first, then re-validated after writing. You can roll back any applied patch.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingRollback !== null}
        title="Roll back patch?"
        confirmLabel="Restore from backup"
        busy={rollback.isPending}
        onConfirm={() => {
          const rb = pendingRollback;
          setPendingRollback(null);
          if (rb) rollback.mutate(rb);
        }}
        onCancel={() => setPendingRollback(null)}
      >
        <p>The target file will be restored from its backup. This cannot be undone.</p>
      </ConfirmDialog>

      {apply.isError ? <ErrorState error={apply.error} /> : null}
      {rollback.isError ? <ErrorState error={rollback.error} /> : null}
      {apply.data ? (
        <Card>
          <CardTitle>Apply result</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {apply.data.applied.map((r) => (
              <li key={r.patchId} className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <Badge tone={r.applied ? "low" : "high"}>
                    {r.applied ? "applied" : "not applied"}
                  </Badge>{" "}
                  <span className="font-mono text-xs">{r.patchId}</span>
                  {r.targetFile ? (
                    <span className="break-all font-mono text-xs text-[var(--al-text-muted)]">
                      {" "}
                      → {r.targetFile}
                    </span>
                  ) : null}
                  <span className="ml-2 text-xs text-[var(--al-text-muted)]">{r.rollbackHint}</span>
                </div>
                {/* Applied patches self-clear their finding on write, so the patch
                 * row vanishes on refetch — expose rollback here instead (§3.5
                 * step 7). rollbackPatch needs patchId + targetFile to restore. */}
                {r.applied && r.backupPath ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      setPendingRollback({ patchId: r.patchId, targetFile: r.targetFile })
                    }
                    disabled={rollback.isPending}
                  >
                    Roll back
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {apply.data.draftsWritten.skills.length + apply.data.draftsWritten.hooks.length > 0 ? (
            <p className="mt-3 text-xs text-[var(--al-text-muted)]">
              Drafts written to exports/drafts/ (review only — never installed):{" "}
              {apply.data.draftsWritten.skills.length} skill(s),{" "}
              {apply.data.draftsWritten.hooks.length} hook(s).
            </p>
          ) : null}
        </Card>
      ) : null}
      {rollback.data ? (
        <Card>
          <CardTitle>Rollback result</CardTitle>
          <p className="mt-3 text-sm">
            <Badge tone={rollback.data.result.restored ? "low" : "high"}>
              {rollback.data.result.restored ? "restored" : "not restored"}
            </Badge>{" "}
            <span className="font-mono text-xs">{rollback.data.result.patchId}</span>
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function HealthScore({
  score,
}: {
  score: {
    total: number;
    critical: number;
    warning: number;
    patches: number;
    refusedPatches: number;
  };
}) {
  const healthy = score.critical === 0 && score.warning === 0;
  return (
    <div className="flex items-center gap-3 rounded-[var(--al-radius-xl)] border border-[var(--al-border)] bg-[var(--al-bg-elevated)] px-4 py-3 shadow-[var(--al-shadow-sm)]">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-full"
        style={{ background: healthy ? "var(--al-accent-weak)" : "var(--al-warning-weak)" }}
      >
        {healthy ? (
          <ShieldCheck size={20} className="text-[var(--al-accent)]" />
        ) : (
          <AlertTriangle size={20} className="text-[var(--al-warning)]" />
        )}
      </div>
      <div>
        <p className="text-xs font-medium text-[var(--al-text-muted)]">Health score</p>
        <p className="text-sm font-semibold text-[var(--al-text)]">
          {healthy ? "Healthy" : `${score.critical} critical · ${score.warning} warning`}
        </p>
      </div>
    </div>
  );
}

function DoctorBody({
  data,
  appliedPatchIds,
  onApply,
  onRollback,
  applyBusy,
  rollbackBusy,
}: {
  data: DoctorResponse;
  appliedPatchIds: Set<string>;
  onApply: (patches: DoctorPatch[]) => void;
  onRollback: (patch: { patchId: string; targetFile?: string }) => void;
  applyBusy: boolean;
  rollbackBusy: boolean;
}) {
  const report = data.report;
  const applicable = report.patches.filter((p) => !p.refused && p.diff);
  const findingsByScope = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of report.findings) m.set(f.scope, (m.get(f.scope) ?? 0) + 1);
    return Array.from(m.entries());
  }, [report.findings]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Findings"
          value={formatNumber(report.summary.total)}
          hint="across all scopes"
        />
        <Stat
          label="Critical"
          value={formatNumber(report.summary.critical)}
          tone={report.summary.critical > 0 ? "text-[var(--al-danger)]" : undefined}
        />
        <Stat
          label="Warnings"
          value={formatNumber(report.summary.warning)}
          tone={report.summary.warning > 0 ? "text-[var(--al-warning)]" : undefined}
        />
        <Stat
          label="Proposed patches"
          value={formatNumber(report.summary.patches)}
          hint={`${report.summary.refusedPatches} refused`}
        />
      </div>

      {findingsByScope.length > 0 ? (
        <Card>
          <CardTitle>Findings by scope</CardTitle>
          <ul className="mt-3 flex flex-wrap gap-3 text-sm">
            {findingsByScope.map(([scope, count]) => (
              <li key={scope} className="flex items-center gap-1.5">
                <Badge tone="neutral">{scope}</Badge>
                <span className="tabular-nums font-medium text-[var(--al-text)]">{count}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <FindingsCard data={data} />

      <PatchesCard
        patches={report.patches}
        appliedPatchIds={appliedPatchIds}
        applicable={applicable}
        onApply={onApply}
        onRollback={onRollback}
        applyBusy={applyBusy}
        rollbackBusy={rollbackBusy}
      />

      {report.diagnostics.length > 0 ? (
        <Card>
          <CardTitle>Diagnostics</CardTitle>
          <ul className="mt-3 space-y-1 text-xs text-[var(--al-text-muted)]">
            {report.diagnostics.map((d, i) => (
              <li key={i} className="break-all">
                <span className="font-mono">{d.path}</span>: {d.message}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function FindingsCard({ data }: { data: DoctorResponse }) {
  const findings = data.report.findings;
  if (findings.length === 0) {
    return (
      <Card>
        <CardTitle>Findings</CardTitle>
        <div className="mt-4">
          <EmptyState title="No findings">Your configuration looks healthy.</EmptyState>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <CardTitle>Findings</CardTitle>
      <ul className="mt-4 divide-y divide-[var(--al-border)] text-sm">
        {findings.map((f) => (
          <li key={f.id} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
              <Badge tone="neutral">{f.family}</Badge>
              <Badge tone="accent">{f.scope}</Badge>
              <span className="font-mono text-xs text-[var(--al-text-muted)]">{f.id}</span>
            </div>
            <p className="mt-1 font-medium text-[var(--al-text)]">{f.title}</p>
            <p className="text-xs text-[var(--al-text-secondary)]">{f.detail}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PatchesCard({
  patches,
  appliedPatchIds,
  applicable,
  onApply,
  onRollback,
  applyBusy,
  rollbackBusy,
}: {
  patches: DoctorPatch[];
  appliedPatchIds: Set<string>;
  applicable: DoctorPatch[];
  onApply: (patches: DoctorPatch[]) => void;
  onRollback: (patch: { patchId: string; targetFile?: string }) => void;
  applyBusy: boolean;
  rollbackBusy: boolean;
}) {
  if (patches.length === 0) {
    return (
      <Card>
        <CardTitle>Proposed patches</CardTitle>
        <div className="mt-4">
          <EmptyState title="No patches">No safe patches to propose.</EmptyState>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Proposed patches</CardTitle>
        {applicable.length > 0 ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => onApply(applicable)}
            disabled={applyBusy}
          >
            Apply {applicable.length} patch(es)…
          </Button>
        ) : null}
      </div>
      <ul className="mt-4 space-y-3">
        {patches.map((p) => (
          <PatchRow
            key={p.id}
            patch={p}
            applied={appliedPatchIds.has(p.id)}
            onApply={() => onApply([p])}
            onRollback={() => onRollback({ patchId: p.id, targetFile: p.targetFile })}
            applyBusy={applyBusy}
            rollbackBusy={rollbackBusy}
          />
        ))}
      </ul>
    </Card>
  );
}

function PatchRow({
  patch,
  applied,
  onApply,
  onRollback,
  applyBusy,
  rollbackBusy,
}: {
  patch: DoctorPatch;
  applied: boolean;
  onApply: () => void;
  onRollback: () => void;
  applyBusy: boolean;
  rollbackBusy: boolean;
}) {
  const v = patch.validation;
  const valid =
    v.parses && v.noBypassPermissions && v.noExternalTransmission && v.unrelatedPreserved;
  return (
    <li className="rounded-[var(--al-radius-lg)] border border-[var(--al-border)] bg-[var(--al-bg-inset)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-[var(--al-text-muted)]">{patch.id}</span>
          {patch.refused ? (
            <Badge tone="high">refused</Badge>
          ) : (
            <Badge tone="neutral">{patch.kind}</Badge>
          )}
          {applied ? <Badge tone="low">applied · rollback available</Badge> : null}
        </div>
        <div className="flex gap-2">
          {!patch.refused && patch.diff && !applied ? (
            <Button size="sm" variant="ghost" onClick={onApply} disabled={applyBusy}>
              Apply
            </Button>
          ) : null}
          {applied ? (
            <Button size="sm" variant="danger" onClick={onRollback} disabled={rollbackBusy}>
              Roll back
            </Button>
          ) : null}
        </div>
      </div>

      <p className="mt-2 text-sm font-medium text-[var(--al-text)]">{patch.summary}</p>
      <p className="mt-1 text-sm text-[var(--al-text-secondary)]">{patch.impact}</p>
      {patch.targetFile ? (
        <p className="mt-1 break-all font-mono text-xs text-[var(--al-text-muted)]">
          target: {patch.targetFile}
        </p>
      ) : null}

      {patch.refused && patch.refusalReason ? (
        <p className="mt-3 text-xs text-[var(--al-warning)]">Refused: {patch.refusalReason}</p>
      ) : null}

      {patch.diff ? (
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-[var(--al-radius-md)] border border-[var(--al-border)] bg-[var(--al-bg-elevated)] p-3 font-mono text-xs text-[var(--al-text)]">
          {patch.diff}
        </pre>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--al-text-muted)]">
        <span>
          validation: <Badge tone={valid ? "low" : "high"}>{valid ? "passes" : "fails"}</Badge>
        </span>
        <span>parses={String(v.parses)}</span>
        <span>no-bypass={String(v.noBypassPermissions)}</span>
        <span>no-external-tx={String(v.noExternalTransmission)}</span>
        <span>preserved={String(v.unrelatedPreserved)}</span>
        <ProvenanceTag provenance="heuristic" />
      </div>
    </li>
  );
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
