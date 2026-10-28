export class SafeError extends Error {}

export function publicError(error: unknown): string {
  // Provider, subprocess and HTTP exceptions can contain tokens or response bodies.
  return error instanceof SafeError ? error.message : "Operation failed. Inspect local setup; sensitive provider details were suppressed.";
}
