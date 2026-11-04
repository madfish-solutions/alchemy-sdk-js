/** Turns a rejection reason into an Error. `undefined` and `null` get `fallback`. */
export function toError(value: unknown, fallback = 'Unknown error'): Error {
  if (value instanceof Error) {
    return value;
  }
  if (value === undefined || value === null) {
    return new Error(fallback);
  }
  return new Error(String(value));
}
