/** Successful outcome carrying a value. */
export type Ok<T> = { readonly ok: true; readonly value: T };

/** Failed outcome carrying an error. */
export type Err<E> = { readonly ok: false; readonly error: E };

/** Explicit success/failure result; used instead of throwing for expected errors. */
export type Result<T, E> = Ok<T> | Err<E>;

/** Wraps a value in a successful {@link Result}. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Wraps an error in a failed {@link Result}. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}
