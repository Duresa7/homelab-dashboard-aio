export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

export function errorName(err: unknown): string {
  if (err instanceof Error) return err.name;
  if (err && typeof err === 'object' && 'name' in err)
    return String((err as { name: unknown }).name);
  return '';
}
