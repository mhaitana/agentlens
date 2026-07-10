/**
 * TanStack Query hooks over the local API (spec §13.9, §17).
 *
 * Each hook maps to one API endpoint and returns the typed view. The hooks are
 * the only place the dashboard touches `api.*`, so features stay declarative
 * and TanStack Query handles caching/invalidation centrally.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { qk } from "../lib/queryClient.js";
import type {
  AnalyticsSnapshot,
  OnboardingResponse,
  PageEnvelope,
  LiveStatus,
  PrivacyInfo,
  ProjectItem,
  RecommendationRow,
  RuleInfo,
  SessionDetailResponse,
  SessionListItem,
  SettingsResponse,
  StatusResponse,
  TimelineEvent,
} from "../lib/types.js";

export function useStatus() {
  return useQuery<StatusResponse>({
    queryKey: qk.status,
    queryFn: () => api.get<StatusResponse>("/status"),
  });
}

export function useOnboarding() {
  return useQuery<OnboardingResponse>({
    queryKey: qk.onboarding,
    queryFn: () => api.get<OnboardingResponse>("/onboarding"),
  });
}

export interface MetricsArgs {
  period: string;
  projectId?: string;
  sessionId?: string;
  project?: string;
}

export function useMetrics(args: MetricsArgs) {
  return useQuery<AnalyticsSnapshot>({
    queryKey: qk.metrics(args.period, args.projectId, args.sessionId),
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("period", args.period);
      if (args.projectId) params.set("projectId", args.projectId);
      if (args.sessionId) params.set("sessionId", args.sessionId);
      if (args.project) params.set("project", args.project);
      return api.get<AnalyticsSnapshot>(`/metrics?${params.toString()}`);
    },
  });
}

export interface SessionFilters {
  projectId?: string;
  modelId?: string;
  status?: string;
  since?: string;
  until?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export function useSessions(filters: SessionFilters) {
  return useQuery<PageEnvelope<SessionListItem>>({
    queryKey: qk.sessions(filters),
    queryFn: () => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== "" && v !== null) params.set(k, String(v));
      }
      return api.get<PageEnvelope<SessionListItem>>(`/sessions?${params.toString()}`);
    },
  });
}

export function useSession(id: string | undefined) {
  return useQuery<SessionDetailResponse>({
    queryKey: id ? qk.session(id) : ["session", "none"],
    enabled: !!id,
    queryFn: () => api.get<SessionDetailResponse>(`/sessions/${id}`),
  });
}

export function useSessionEvents(id: string | undefined) {
  return useQuery<TimelineEvent[]>({
    queryKey: id ? qk.sessionEvents(id) : ["session-events", "none"],
    enabled: !!id,
    queryFn: () => api.get<TimelineEvent[]>(`/sessions/${id}/events`),
  });
}

export function useSessionRecommendations(id: string | undefined) {
  return useQuery<RecommendationRow[]>({
    queryKey: id ? qk.sessionRecommendations(id) : ["session-recs", "none"],
    enabled: !!id,
    queryFn: () => api.get<RecommendationRow[]>(`/sessions/${id}/recommendations`),
  });
}

export function useProjects() {
  return useQuery<PageEnvelope<ProjectItem>>({
    queryKey: qk.projects,
    queryFn: () => api.get<PageEnvelope<ProjectItem>>("/projects?limit=200"),
  });
}

export function useRecommendations(projectId?: string) {
  return useQuery<RecommendationRow[]>({
    queryKey: qk.recommendations(projectId),
    queryFn: () => {
      const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      return api.get<RecommendationRow[]>(`/recommendations${qs}`);
    },
  });
}

/** Dismiss a recommendation (POST /recommendations/:id/dismiss, token-gated). */
export function useDismissRecommendation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ id: string; status: string }>(`/recommendations/${id}/dismiss`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recommendations"] }),
  });
}

/** Restore a dismissed recommendation (POST /recommendations/:id/restore). */
export function useRestoreRecommendation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ id: string; status: string }>(`/recommendations/${id}/restore`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recommendations"] }),
  });
}

export function useRules() {
  return useQuery<RuleInfo[]>({
    queryKey: qk.rules,
    queryFn: () => api.get<RuleInfo[]>("/rules"),
  });
}

export function usePrivacy() {
  return useQuery<PrivacyInfo>({
    queryKey: qk.privacy,
    queryFn: () => api.get<PrivacyInfo>("/privacy"),
  });
}

export function useSettings() {
  return useQuery<SettingsResponse>({
    queryKey: qk.settings,
    queryFn: () => api.get<SettingsResponse>("/settings"),
  });
}

/** Update a single config setting (POST /api/v1/settings, token-gated). */
export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      api.post<{ ok: boolean; key: string }>("/settings", { key, value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.settings });
      qc.invalidateQueries({ queryKey: qk.privacy });
      qc.invalidateQueries({ queryKey: qk.status });
    },
  });
}

/** Purge all stored data (POST /api/v1/privacy/purge, token-gated). */
export function usePurgeData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ purged: boolean }>("/privacy/purge"),
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}

/** Export all stored data (POST /api/v1/privacy/export). */
export function useExportData() {
  return useMutation({
    mutationFn: () =>
      api.post<{
        exportedAt: string;
        privacyMode: string;
        sessions: unknown;
        projects: unknown;
        recommendations: unknown;
      }>("/privacy/export"),
  });
}

/** GET /api/v1/live — live collector status snapshot (spec §14.10). Refreshed
 * frequently so the Live view reflects collector health even without SSE. */
export function useLive() {
  return useQuery<LiveStatus>({
    queryKey: qk.live,
    queryFn: () => api.get<LiveStatus>("/live"),
    // Live status is volatile; poll on top of the SSE stream.
    staleTime: 2_000,
    refetchInterval: 5_000,
  });
}
