// Error utility functions

/**
 * Ensure a value is an Error instance.
 * Converts non-Error values to Error with String representation.
 */
export function ensureError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
