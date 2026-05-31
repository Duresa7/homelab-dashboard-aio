import { useEffect, useState } from 'react';

export function Clock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div className="hidden font-mono text-[13px] tabular-nums text-muted-foreground md:block">
      {pad(t.getHours())}:{pad(t.getMinutes())}
      <span className="opacity-50">:{pad(t.getSeconds())}</span>
    </div>
  );
}
