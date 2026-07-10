import { QueryClient } from "@tanstack/react-query";

/**
 * TanStack Query client factory. Stale time is generous because the data is
 * local and only changes on explicit scans — no need to refetch aggressively.
 * Mutations invalidate relevant query keys so the UI updates after edits.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
      },
      mutations: { retry: 0 },
    },
  });
}

/** Centralised query keys (so invalidation is type-safe and discoverable). */
export const qk = {
  status: ["status"] as const,
  onboarding: ["onboarding"] as const,
  metrics: (period: string, projectId?: string, sessionId?: string) =>
    ["metrics", period, projectId ?? null, sessionId ?? null] as const,
  sessions: (filters: unknown) => ["sessions", filters] as const,
  session: (id: string) => ["session", id] as const,
  sessionEvents: (id: string) => ["session-events", id] as const,
  sessionRecommendations: (id: string) => ["session-recs", id] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  recommendations: (projectId?: string) => ["recommendations", projectId ?? null] as const,
  rules: ["rules"] as const,
  privacy: ["privacy"] as const,
  settings: ["settings"] as const,
  live: ["live"] as const,
};
