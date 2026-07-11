/**
 * Doctor API routes (spec §15.7–15.11, §17 `/api/v1/doctor`).
 *
 * The Configuration Doctor implementation lives in the CLI package (it owns
 * Claude-Code-shape inspection). To expose it over the local API without an
 * app→app circular dependency (the CLI already depends on `@agentlens/local-api`,
 * so local-api cannot depend back on the CLI), the `agentlens dashboard` launcher
 * hands this registrar to {@link ServerDeps.registerExtraRoutes}, which
 * `buildServer` invokes after the core routes.
 *
 * Safety (§3.5, §15.9): the read route writes nothing. `apply` requires an
 * explicit `approved: true` in the request body (the dashboard's Apply button is
 * the §3.5 "explicit approval" step, shown only after the diff + impact preview).
 * Apply backs up before writing and validates after; `rollback` restores from
 * the backup. Nothing is ever auto-applied (`automaticallyApplicable: false`).
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ServerDeps } from "@agentlens/local-api";
import type {
  DoctorReport,
  PatchApplicationResult,
  ProposedPatch,
  RollbackResult,
} from "@agentlens/domain";
import { runDoctor } from "./doctor.js";
import { applyPatch, rollbackPatch, type ApplySecurityCtx } from "./apply.js";
import { writeDrafts } from "./drafts.js";
import { resolveClaudeHome, resolveProjectPath } from "./inspect.js";
import { canonicaliseInputPath } from "./targets.js";
import { badRequest, notFound } from "@agentlens/local-api";

/** Fastify instance type, derived from the local-api contract (no fastify dep). */
type FastifyApp = Parameters<NonNullable<ServerDeps["registerExtraRoutes"]>>[0];

const DoctorQuerySchema = z.object({
  project: z.string().optional(),
  claudeHome: z.string().optional(),
});

const ApplyBodySchema = z.object({
  /** Explicit approval (§3.5 step 5) — the dashboard sends true only after the
   *  user reviews the diff + impact and clicks Apply. */
  approved: z.boolean(),
  /** Optional subset of patch ids to apply; omitted = all non-refused patches. */
  patchIds: z.array(z.string()).optional(),
  claudeHome: z.string().optional(),
  project: z.string().optional(),
});

const RollbackBodySchema = z.object({
  patchId: z.string().min(1),
  /** The patch's target file (carried from the /doctor or /doctor/apply
   *  response). Required to restore the right file. */
  targetFile: z.string().optional(),
  claudeHome: z.string().optional(),
  project: z.string().optional(),
});

/** Patch ids that have a backup on disk (i.e. were applied and can roll back). */
function listAppliedPatchIds(home: string): string[] {
  const dir = join(home, "backups", "doctor");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".bak"))
    .map((f) => f.slice(0, -".bak".length));
}

/** Run a fresh read-only doctor report, honouring overrides (§21). */
function freshReport(deps: ServerDeps, claudeHome?: string, project?: string): DoctorReport {
  return runDoctor({
    claudeHomeOverride: claudeHome,
    projectPathOverride: project,
    nowIso: (deps.now ?? new Date()).toISOString(),
  });
}

/**
 * Resolve the security context (approved-path roots) from request-supplied
 * overrides (§19.2). Inputs are canonicalised to absolute, normalised paths;
 * relative or empty values are dropped so the allowlist falls back to the
 * resolved defaults rather than trusting a partial request value.
 */
function resolveSecurityCtx(claudeHome?: string, project?: string): ApplySecurityCtx {
  const home = resolveClaudeHome(canonicaliseInputPath(claudeHome));
  const projectPath = resolveProjectPath(canonicaliseInputPath(project));
  return projectPath ? { claudeHome: home, projectPath } : { claudeHome: home };
}

/** Register the /api/v1/doctor* routes on the given Fastify instance. */
export function registerDoctorRoutes(app: FastifyApp, deps: ServerDeps): void {
  // GET /api/v1/doctor — read-only report (findings, proposed patches, drafts)
  // plus the list of patches with backups (rollback-eligible).
  app.get("/api/v1/doctor", async (req) => {
    const q = DoctorQuerySchema.parse(req.query);
    // §19.2: canonicalise request-supplied paths; reject relative/empty values so
    // the read side never follows an unnormalised path. The operator may point at
    // any project root; the write-side allowlist is the hard boundary.
    const claudeHome = canonicaliseInputPath(q.claudeHome);
    const project = canonicaliseInputPath(q.project);
    const report = freshReport(deps, claudeHome, project);
    return { report, appliedPatchIds: listAppliedPatchIds(deps.home) };
  });

  // POST /api/v1/doctor/apply — apply approved patches after explicit consent.
  // Token-gated by the global security hook (POST). Never auto-applies: the
  // body MUST carry `approved: true`.
  app.post("/api/v1/doctor/apply", async (req, reply) => {
    const body = ApplyBodySchema.parse(req.body);
    if (!body.approved) {
      throw badRequest(
        "Explicit approval required: send { approved: true } after reviewing the diff + impact. Nothing was changed.",
      );
    }
    const ctx = resolveSecurityCtx(body.claudeHome, body.project);
    const report = freshReport(deps, body.claudeHome, body.project);
    const nowIso = (deps.now ?? new Date()).toISOString();
    const wantIds = body.patchIds ? new Set(body.patchIds) : null;
    const applied: PatchApplicationResult[] = [];
    for (const patch of report.patches) {
      if (patch.refused || !patch.diff) continue;
      if (wantIds && !wantIds.has(patch.id)) continue;
      applied.push(applyPatch(patch, deps.home, nowIso, ctx));
    }
    const draftsWritten = writeDrafts(deps.home, report.skillDrafts, report.hookDrafts);
    reply.send({ applied, draftsWritten, appliedPatchIds: listAppliedPatchIds(deps.home) });
    return reply;
  });

  // POST /api/v1/doctor/rollback — restore a previously applied patch from its
  // backup (§3.5 step 7). Token-gated. The restore target is authoritative from
  // the sidecar written at apply time (§19.2) — the request body targetFile is
  // ignored on the server.
  app.post("/api/v1/doctor/rollback", async (req, reply) => {
    const body = RollbackBodySchema.parse(req.body);
    const appliedIds = listAppliedPatchIds(deps.home);
    if (!appliedIds.includes(body.patchId)) {
      return notFound(`No backup found for patch ${body.patchId}; nothing to roll back.`);
    }
    const ctx = resolveSecurityCtx(body.claudeHome, body.project);
    // rollbackPatch reads patch.id + the authoritative sidecar target; the
    // client-supplied targetFile is intentionally NOT forwarded (§19.2).
    const minimal: ProposedPatch = {
      id: body.patchId,
      kind: "unified-diff",
      targetFile: undefined,
      summary: "",
      impact: "",
      diff: "",
      addresses: [],
      automaticallyApplicable: false,
      validation: {
        parses: true,
        noBypassPermissions: true,
        noExternalTransmission: true,
        unrelatedPreserved: true,
        notes: [],
      },
      refused: false,
    };
    const result: RollbackResult = rollbackPatch(minimal, deps.home, ctx);
    reply.send({ result, appliedPatchIds: listAppliedPatchIds(deps.home) });
    return reply;
  });
}
