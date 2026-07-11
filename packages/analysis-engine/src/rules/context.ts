/**
 * CONTEXT-001..002 deterministic rules (spec §13.10).
 *
 * Context-efficiency rules read the usage/tool metrics from the snapshot and
 * emit at most one candidate each.
 */
import type { RecommendationRule } from "@agentlens/domain";
import { candidate, evidence, instructionRemediation, metric, num, threshold } from "./helpers.js";

/** CONTEXT-001 Frequent compaction. */
export function context001(): RecommendationRule {
  return {
    id: "CONTEXT-001",
    version: 1,
    category: "context",
    defaultThresholds: { minCompactions: 2, minPreCompactionTokens: 100_000 },
    async evaluate(ctx) {
      const totalCompactions = num(ctx.snapshot.usage.totalCompactions) ?? 0;
      const min = threshold(ctx, "minCompactions", 2);
      if (totalCompactions < min) return [];
      // Sessions with repeated compactions or unusually high pre-compaction context.
      const sessions = ctx.snapshot.usage.totalSessions.value as number;
      const compactionsPerSession = sessions > 0 ? totalCompactions / sessions : 0;
      const confidence = Math.min(0.8, 0.45 + Math.min(1, compactionsPerSession) * 0.3);
      return [
        candidate({
          ctx,
          ruleId: "CONTEXT-001",
          ruleVersion: 1,
          category: "context",
          severity: "medium",
          confidence,
          title: "Frequent compaction",
          summary: `${totalCompactions} compaction(s) across ${sessions} session(s)`,
          explanation: `Repeated compactions indicate the context grew large enough to be summarised. Each compaction can drop detail and costs tokens. Reducing always-on context or large repeated outputs helps.`,
          evidence: [
            evidence("frequent-compaction", `${totalCompactions} compactions`, [
              metric("totalCompactions", totalCompactions, "exact"),
              metric("sessions", sessions, "exact"),
              metric("compactionsPerSession", Number(compactionsPerSession.toFixed(2)), "inferred"),
            ]),
          ],
          remediation: instructionRemediation(
            "Trim always-on context (skills/plugins/large files) and avoid repeatedly re-reading large outputs.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** CONTEXT-002 Large repeated outputs. */
export function context002(): RecommendationRule {
  return {
    id: "CONTEXT-002",
    version: 1,
    category: "context",
    defaultThresholds: { minOutputBytes: 100_000, minRepeatedCommands: 1 },
    async evaluate(ctx) {
      const largest = num(ctx.snapshot.tools.largestToolOutputsBytes);
      const repeated = ctx.snapshot.tools.repeatedCommands;
      const minBytes = threshold(ctx, "minOutputBytes", 100_000);
      const minRepeated = threshold(ctx, "minRepeatedCommands", 1);
      if (largest == null || largest < minBytes) return [];
      if (repeated.length < minRepeated) return [];
      const confidence = Math.min(0.75, 0.45 + Math.min(1, largest / (minBytes * 4)) * 0.25);
      return [
        candidate({
          ctx,
          ruleId: "CONTEXT-002",
          ruleVersion: 1,
          category: "context",
          severity: "medium",
          confidence,
          title: "Large repeated outputs",
          summary: `Largest output ${(largest / 1024).toFixed(0)} KiB with ${repeated.length} repeated command pattern(s)`,
          explanation: `Large command outputs repeatedly entered the session context. Combined with repeated commands, this inflates context and can trigger compaction.`,
          evidence: [
            evidence(
              "large-repeated-output",
              `${largest} byte largest output, ${repeated.length} repeated command groups`,
              [
                metric("largestOutputBytes", largest, "reported"),
                metric("repeatedCommandGroups", repeated.length, "exact"),
              ],
            ),
          ],
          remediation: instructionRemediation(
            "Summarise or page large outputs, write them to a file, or pipe through a filter before they enter context.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** CONTEXT-003 Excessive stale context (high cache-read share + compaction). */
export function context003(): RecommendationRule {
  return {
    id: "CONTEXT-003",
    version: 1,
    category: "context",
    defaultThresholds: { minCacheReadShare: 0.6, minCompactions: 1 },
    async evaluate(ctx) {
      const cacheRead = num(ctx.snapshot.usage.cacheReadTokens) ?? 0;
      const input = num(ctx.snapshot.usage.inputTokens) ?? 0;
      const compactions = num(ctx.snapshot.usage.totalCompactions) ?? 0;
      const minShare = threshold(ctx, "minCacheReadShare", 0.6);
      const minCompactions = threshold(ctx, "minCompactions", 1);
      const totalInput = cacheRead + input;
      if (totalInput === 0) return [];
      const cacheReadShare = cacheRead / totalInput;
      if (cacheReadShare < minShare || compactions < minCompactions) return [];
      const confidence = Math.min(0.7, 0.4 + Math.min(1, cacheReadShare) * 0.3);
      return [
        candidate({
          ctx,
          ruleId: "CONTEXT-003",
          ruleVersion: 1,
          category: "context",
          severity: "low",
          confidence,
          title: "Excessive stale context",
          summary: `${(cacheReadShare * 100).toFixed(0)}% of input tokens were cache reads with ${compactions} compaction(s)`,
          explanation: `A large share of input tokens came from the prompt cache alongside compaction. This suggests stale context is being carried and re-summariesed rather than refreshed. Starting a focused session or trimming always-on context reduces this.`,
          evidence: [
            evidence("stale-context", "High cache-read share with compaction", [
              metric("cacheReadTokens", cacheRead, "reported"),
              metric("inputTokens", input, "reported"),
              metric("cacheReadShare", Number(cacheReadShare.toFixed(2)), "inferred"),
              metric("compactions", compactions, "exact"),
            ]),
          ],
          remediation: instructionRemediation(
            "Start a fresh session for a new objective and trim always-on context (skills, large files, persistent outputs).",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** CONTEXT-004 Verbose exploration producing large context (delegatable). */
export function context004(): RecommendationRule {
  return {
    id: "CONTEXT-004",
    version: 1,
    category: "context",
    defaultThresholds: { minReads: 12, minSearches: 6, maxFilesChanged: 2 },
    async evaluate(ctx) {
      const repeatedReads = ctx.snapshot.tools.repeatedReads;
      const repeatedSearches = ctx.snapshot.tools.repeatedSearches;
      const readOccurrences = repeatedReads.reduce((a, r) => a + r.occurrences, 0);
      const searchOccurrences = repeatedSearches.reduce((a, r) => a + r.occurrences, 0);
      const minReads = threshold(ctx, "minReads", 12);
      const minSearches = threshold(ctx, "minSearches", 6);
      const maxFiles = threshold(ctx, "maxFilesChanged", 2);
      const filesChanged = num(ctx.snapshot.workflow.filesChangedPerSession) ?? 0;
      if (readOccurrences < minReads && searchOccurrences < minSearches) return [];
      if (filesChanged > maxFiles) return [];
      const total = readOccurrences + searchOccurrences;
      const confidence = Math.min(0.65, 0.35 + Math.min(1, total / (minReads + minSearches)) * 0.3);
      return [
        candidate({
          ctx,
          ruleId: "CONTEXT-004",
          ruleVersion: 1,
          category: "context",
          severity: "low",
          confidence,
          title: "Verbose exploration",
          summary: `${readOccurrences} repeated reads + ${searchOccurrences} repeated searches, ${filesChanged} file(s) changed`,
          explanation: `A lot of exploration (reads/searches) produced context but very few files changed. The exploration could often be delegated to a subagent or scoped to a tighter question so the main context stays clean.`,
          evidence: [
            evidence("verbose-exploration", "High exploration volume, low change volume", [
              metric("repeatedReadOccurrences", readOccurrences, "exact"),
              metric("repeatedSearchOccurrences", searchOccurrences, "exact"),
              metric("filesChangedPerSession", filesChanged, "inferred"),
            ]),
          ],
          remediation: instructionRemediation(
            "Delegate broad exploration to a subagent and bring back only the conclusion, or scope the question to a single entry point.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}
