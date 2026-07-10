/**
 * Stable error shapes + a Fastify error handler (spec §17).
 *
 * All errors leave the API as `{ code, message, details? }` with a sensible
 * HTTP status. Messages are redacted by construction — they never echo request
 * bodies, paths, or secrets back to the client.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiError } from "./deps.js";

/** Thrown inside handlers to produce a stable error response. */
export class ApiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}

export const badRequest = (message: string, details?: unknown): ApiHttpError =>
  new ApiHttpError(400, "bad_request", message, details);
export const notFound = (message: string): ApiHttpError =>
  new ApiHttpError(404, "not_found", message);
export const forbidden = (message: string): ApiHttpError =>
  new ApiHttpError(403, "forbidden", message);
export const conflict = (message: string): ApiHttpError =>
  new ApiHttpError(409, "conflict", message);
export const unprocessable = (message: string, details?: unknown): ApiHttpError =>
  new ApiHttpError(422, "unprocessable", message, details);

function payload(err: ApiHttpError): ApiError {
  const body: ApiError = { code: err.code, message: err.message };
  if (err.details !== undefined) body.details = err.details;
  return body;
}

/** Install the versioned error handler on a Fastify instance. */
export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiHttpError) {
      reply.code(err.status).send(payload(err));
      return;
    }
    // Fastify's own validation errors (zod parse failures wrapped manually).
    if ((err as { validation?: unknown }).validation !== undefined) {
      reply.code(400).send({
        code: "bad_request",
        message: "Request validation failed",
        details: (err as { validation: unknown }).validation,
      } satisfies ApiError);
      return;
    }
    // Never leak internal error text to the client.
    reply
      .code(500)
      .send({ code: "internal_error", message: "An internal error occurred." } satisfies ApiError);
  });

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    reply.code(404).send({
      code: "not_found",
      message: `No route for ${req.method} ${req.url}`,
    } satisfies ApiError);
  });
}
