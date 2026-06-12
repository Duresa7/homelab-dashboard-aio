let _idTick = 0;

export function genId(prefix = 'x'): string {
  _idTick += 1;
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${t}${r}${_idTick.toString(36)}`;
}
