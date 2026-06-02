import { useEffect, useState } from 'react';
import {
  formatClockDate,
  formatClockTime,
  timeZoneLabel,
  type DateTimePreferences,
} from '../../lib/datetime';

interface Props {
  preferences: DateTimePreferences;
}

export function Clock({ preferences }: Props) {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      className="hidden min-w-0 flex-col items-end font-mono text-[12px] leading-tight tabular-nums text-muted-foreground lg:flex"
      title={timeZoneLabel(preferences.timeZone)}
    >
      <span>{formatClockTime(t, preferences)}</span>
      <span className="text-[10px] opacity-60">{formatClockDate(t, preferences)}</span>
    </div>
  );
}
