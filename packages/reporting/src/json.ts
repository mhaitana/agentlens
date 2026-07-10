/**
 * JSON report renderer (spec §13.7).
 *
 * Emits the analytics snapshot as stable JSON for `--format json` / automation.
 * The mandatory cost disclaimer is attached as a sibling field so any consumer
 * can surface it without parsing prose.
 */

import type { AnalyticsSnapshot } from "@agentlens/domain";
import { COST_ESTIMATE_LABEL } from "./format.js";

/** Render the full snapshot as a JSON string. */
export function renderJson(snapshot: AnalyticsSnapshot): string {
  const payload = {
    generatedAt: snapshot.generatedAt,
    filters: snapshot.filters,
    privacyMode: snapshot.privacyMode,
    usage: snapshot.usage,
    tools: snapshot.tools,
    workflow: snapshot.workflow,
    cost: snapshot.cost,
    completeness: snapshot.completeness,
    completion: snapshot.completion,
    scanProvenance: snapshot.scanProvenance,
    recommendations: snapshot.recommendations,
    minimumRecommendationConfidence: snapshot.minimumRecommendationConfidence,
    costDisclaimer: COST_ESTIMATE_LABEL,
  };
  return JSON.stringify(payload, null, 2);
}
