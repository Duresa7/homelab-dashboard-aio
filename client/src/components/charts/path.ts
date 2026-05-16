export function polylinePath(vals: number[], w: number, h: number, pad = 2): string {
  if (!vals.length) return '';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = Math.max(1e-6, max - min);
  const dx = (w - pad * 2) / (vals.length - 1 || 1);
  return vals
    .map((v, i) => {
      const x = pad + i * dx;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
