/**
 * Pagination helpers (spec §17 "paginate large collections").
 *
 * Page-based pagination with a hard cap; the cursor is the page number. We use
 * simple page/limit query params (validated by Zod at the route) and return a
 * `{ items, page, limit, total, hasMore }` envelope.
 */
export interface PageParams {
  page: number;
  limit: number;
}

export interface PageEnvelope<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

/** Absolute caps applied regardless of the requested limit (§17). */
export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;

/** Clamp user-supplied page params to safe bounds. */
export function clampPage(page: unknown, limit: unknown): PageParams {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const l = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(limit) || DEFAULT_LIMIT)));
  return { page: p, limit: l };
}

/** Build the envelope for a slice of items + the total count. */
export function paginate<T>(items: T[], params: PageParams, total: number): PageEnvelope<T> {
  return {
    items,
    page: params.page,
    limit: params.limit,
    total,
    hasMore: params.page * params.limit < total,
  };
}
