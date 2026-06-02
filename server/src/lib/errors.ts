/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * `catch` clauses are typed `unknown` under `strict`, so this centralizes the
 * narrowing the integrations all need (`err.message` for the common Error case,
 * a string passthrough, and a defensive `String()` fallback for anything else).
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

/** Narrow an unknown thrown value to its `.name` (DOMException/Error), or ''. */
export function errorName(err: unknown): string {
  if (err instanceof Error) return err.name;
  if (err && typeof err === 'object' && 'name' in err)
    return String((err as { name: unknown }).name);
  return '';
}
