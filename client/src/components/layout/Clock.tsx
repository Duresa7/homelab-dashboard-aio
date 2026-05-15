import { useEffect, useState } from 'react';

export function Clock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div className="tb-clock">
      {pad(t.getHours())}:{pad(t.getMinutes())}:{pad(t.getSeconds())}
    </div>
  );
}
