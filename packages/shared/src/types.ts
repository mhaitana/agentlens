/** Nominal typing helper for IDs that should not be freely interchangeable. */
export type Branded<T, B extends string> = T & { readonly __brand: B };

/** Exhaustiveness check for discriminated unions. */
export function assertNever(value: never): never {
  throw new Error(`Unreachable: unexpected value ${JSON.stringify(value)}`);
}

/** Successful Result. */
export interface Ok<T> {
  ok: true;
  value: T;
}

/** Failed Result. */
export interface Err<E> {
  ok: false;
  error: E;
}

/** Fallible-operation result without exceptions. */
export type Result<T, E = Error> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}
