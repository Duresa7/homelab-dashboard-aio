import type { ReactElement } from 'react';

export type IconName =
  | 'home' | 'cpu' | 'server' | 'network' | 'box' | 'disk' | 'wifi'
  | 'bell' | 'settings' | 'moon' | 'sun' | 'refresh' | 'expand'
  | 'chart_area' | 'chart_bar' | 'chart_line' | 'chart_donut' | 'chart_gauge'
  | 'play' | 'stop' | 'plus' | 'x' | 'drag' | 'fan' | 'bolt' | 'shield'
  | 'globe' | 'activity' | 'check' | 'cloud' | 'layers' | 'cube' | 'history';

interface Props {
  name: IconName;
  size?: number;
  className?: string;
}

const PATHS: Record<IconName, ReactElement> = {
  home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v9h14v-9" /></>,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="1" /><path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3" /></>,
  server: <><rect x="3" y="4" width="18" height="6" rx="1" /><rect x="3" y="14" width="18" height="6" rx="1" /><circle cx="7" cy="7" r=".5" fill="currentColor" /><circle cx="7" cy="17" r=".5" fill="currentColor" /></>,
  network: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><circle cx="12" cy="6" r="2" /><path d="M12 8v4M8 14l3-2M16 14l-3-2" /></>,
  box: <><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></>,
  disk: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  wifi: <><path d="M2 9c5.5-5 14.5-5 20 0" /><path d="M5 12.5c4-3.5 10-3.5 14 0" /><path d="M8.5 16c2-1.5 5-1.5 7 0" /><circle cx="12" cy="19" r=".7" fill="currentColor" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9z" /><path d="M10 21a2 2 0 0 0 4 0" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a7.97 7.97 0 0 0 0-6l1.6-1.3-2-3.4-2 .8a8 8 0 0 0-5.2-3L11.5 0h-4l-.3 2a8 8 0 0 0-5.2 3l-2-.8-2 3.4L0 9a7.97 7.97 0 0 0 0 6l-1.6 1.3" /></>,
  moon: <><path d="M21 12.5A9 9 0 1 1 11.5 3a7 7 0 0 0 9.5 9.5z" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  refresh: <><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></>,
  expand: <><path d="M4 14v6h6M20 10V4h-6M4 20l7-7M20 4l-7 7" /></>,
  chart_area: <><path d="M3 17l4-5 4 3 5-7 5 6" /><path d="M3 21h18" /></>,
  chart_bar: <><path d="M4 20V10M10 20V4M16 20V14M22 20H2" /></>,
  chart_line: <><path d="M3 17l4-5 4 3 5-7 5 6" /></>,
  chart_donut: <><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 9 9h-9z" fill="currentColor" /></>,
  chart_gauge: <><path d="M3 14a9 9 0 0 1 18 0" /><path d="M12 14l4-4" /></>,
  play: <><path d="M6 4l14 8-14 8z" fill="currentColor" /></>,
  stop: <><rect x="6" y="6" width="12" height="12" fill="currentColor" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  x: <><path d="M5 5l14 14M19 5L5 19" /></>,
  drag: <><circle cx="9" cy="6" r=".7" fill="currentColor" /><circle cx="15" cy="6" r=".7" fill="currentColor" /><circle cx="9" cy="12" r=".7" fill="currentColor" /><circle cx="15" cy="12" r=".7" fill="currentColor" /><circle cx="9" cy="18" r=".7" fill="currentColor" /><circle cx="15" cy="18" r=".7" fill="currentColor" /></>,
  fan: <><circle cx="12" cy="12" r="2" /><path d="M12 10c0-4 1-8-2-8s-2 4-2 6c0 1 1 2 4 2zM12 14c0 4-1 8 2 8s2-4 2-6c0-1-1-2-4-2zM10 12c-4 0-8-1-8 2s4 2 6 2c1 0 2-1 2-4zM14 12c4 0 8 1 8-2s-4-2-6-2c-1 0-2 1-2 4z" /></>,
  bolt: <><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></>,
  shield: <><path d="M12 3 4 6v6c0 5 3 8 8 9 5-1 8-4 8-9V6z" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  activity: <><path d="M3 12h4l3-9 4 18 3-9h4" /></>,
  check: <><path d="M5 12l5 5 9-11" /></>,
  cloud: <><path d="M7 18a4 4 0 0 1 0-8 6 6 0 0 1 12 1 4 4 0 0 1-1 8z" /></>,
  layers: <><path d="M12 2 2 7l10 5 10-5z" /><path d="M2 12l10 5 10-5" /><path d="M2 17l10 5 10-5" /></>,
  cube: <><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>,
};

export function Icon({ name, size = 14, className = 'ico' }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name] ?? null}
    </svg>
  );
}
